import PostalMime from "postal-mime";
import { sha256, stableId } from "./auth";

export const MAX_RAW_SIZE = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 32;

export interface Env {
  MAILBOX_OBJECTS: R2Bucket;
  MAILBOX_DB: D1Database;
  MAILBOX_ADDRESS: string;
  MAILBOX_API_SECRET: string;
}

type Envelope = { from: string; to: string; receivedAt: string };

function bounded(value: string, bytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= bytes) return value;
  return new TextDecoder().decode(encoded.slice(0, bytes));
}

export async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("payload_too_large");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const item = value as { name?: unknown; address?: unknown; group?: unknown };
  if (Array.isArray(item.group)) return item.group.map(text).filter(Boolean).join(", ");
  const address = typeof item.address === "string" ? item.address : "";
  const name = typeof item.name === "string" ? item.name.replace(/["\\\r\n]/g, " ").trim() : "";
  return name && address ? `"${name}" <${address}>` : address;
}

export async function ingest(env: Env, envelope: Envelope, raw: Uint8Array): Promise<string> {
  const normalizedFrom = envelope.from.trim().toLowerCase();
  const normalizedTo = envelope.to.trim().toLowerCase();
  const id = await stableId([env.MAILBOX_ADDRESS.trim().toLowerCase(), normalizedFrom, normalizedTo, await sha256(raw)]);
  const pendingKey = `pending/${id}.eml`;
  await env.MAILBOX_OBJECTS.put(pendingKey, raw, { customMetadata: { from: bounded(envelope.from, 320), to: bounded(envelope.to, 320), receivedAt: envelope.receivedAt } });
  await indexPending(env, pendingKey, id, raw, envelope);
  return id;
}

export async function indexPending(env: Env, pendingKey: string, id: string, raw: Uint8Array, envelope: Envelope): Promise<void> {
  let parsed: Awaited<ReturnType<PostalMime["parse"]>>;
  try { parsed = await new PostalMime().parse(raw); }
  catch {
    await env.MAILBOX_OBJECTS.put(`quarantine/${id}.eml`, raw, { customMetadata: { reason: "mime_parse_failed", from: envelope.from, to: envelope.to, receivedAt: envelope.receivedAt } });
    await env.MAILBOX_OBJECTS.delete(pendingKey);
    console.warn("mailbox_quarantined", { id, status: "mime_parse_failed" });
    return;
  }
  if (parsed.attachments.length > MAX_ATTACHMENTS) {
    await env.MAILBOX_OBJECTS.put(`quarantine/${id}.eml`, raw, { customMetadata: { reason: "too_many_attachments", from: envelope.from, to: envelope.to, receivedAt: envelope.receivedAt } });
    await env.MAILBOX_OBJECTS.delete(pendingKey);
    console.warn("mailbox_quarantined", { id, status: "too_many_attachments" });
    return;
  }
  const rawKey = `messages/${id}/raw.eml`;
  const bodyKey = `messages/${id}/body.json`;
  const body = JSON.stringify({ text: parsed.text ?? "", html: parsed.html ?? "" });
  const preview = (parsed.text ?? String(parsed.html ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 2048);
  await env.MAILBOX_OBJECTS.put(rawKey, raw);
  await env.MAILBOX_OBJECTS.put(bodyKey, body, { httpMetadata: { contentType: "application/json" } });
  const attachmentStatements: D1PreparedStatement[] = [];
  const attachmentMetadata: Array<{id:string;Filename:string;MIMEType:string;size:number}> = [];
  for (let position = 0; position < parsed.attachments.length; position++) {
    const attachment = parsed.attachments[position];
    const attachmentId = await stableId([id, String(position), attachment.filename ?? "", attachment.mimeType ?? ""]);
    const key = `messages/${id}/attachments/${position}-${attachmentId}`;
    await env.MAILBOX_OBJECTS.put(key, attachment.content);
    const attachmentSize = typeof attachment.content === "string" ? new TextEncoder().encode(attachment.content).byteLength : attachment.content.byteLength;
    attachmentMetadata.push({ id: attachmentId, Filename: bounded(attachment.filename ?? "", 1024), MIMEType: bounded(attachment.mimeType ?? "application/octet-stream", 255), size: attachmentSize });
    attachmentStatements.push(env.MAILBOX_DB.prepare("INSERT OR IGNORE INTO attachments (id,message_id,position,filename,mime_type,size,object_key) VALUES (?,?,?,?,?,?,?)")
      .bind(attachmentId, id, position, attachment.filename ?? "", attachment.mimeType ?? "application/octet-stream", attachmentSize, key));
  }
  const parsedDate = parsed.date ? new Date(parsed.date) : null;
  const sentAt = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : envelope.receivedAt;
  const insert = env.MAILBOX_DB.prepare(`INSERT OR IGNORE INTO messages
    (id,received_at,envelope_from,envelope_to,header_from,header_to,header_cc,header_bcc,reply_to,subject,sent_at,message_id,body_key,body_preview,attachment_json,raw_key,raw_size)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, envelope.receivedAt, envelope.from, envelope.to,
      bounded(text(parsed.from), 8192), bounded(text(parsed.to), 8192), bounded(text(parsed.cc), 8192), bounded(text(parsed.bcc), 8192), bounded(text(parsed.replyTo), 8192), bounded(parsed.subject ?? "", 4096), sentAt,
      bounded(parsed.messageId ?? "", 1024), bodyKey, preview, JSON.stringify(attachmentMetadata), rawKey, raw.byteLength);
  await env.MAILBOX_DB.batch([insert, ...attachmentStatements]);
  await env.MAILBOX_OBJECTS.delete(pendingKey);
  console.log("mailbox_indexed", { id, attachments: parsed.attachments.length, status: "committed" });
}

export async function recoverPending(env: Env): Promise<void> {
  const cursorObject = await env.MAILBOX_OBJECTS.get("_control/recovery-cursor");
  const cursor = cursorObject ? await cursorObject.text() : undefined;
  let listed;
  try { listed = await env.MAILBOX_OBJECTS.list({ prefix: "pending/", limit: 1, cursor }); }
  catch {
    await env.MAILBOX_OBJECTS.delete("_control/recovery-cursor");
    listed = await env.MAILBOX_OBJECTS.list({ prefix: "pending/", limit: 1 });
  }
  if (listed.objects.length === 0 && cursor) listed = await env.MAILBOX_OBJECTS.list({ prefix: "pending/", limit: 1 });
  let recovered = 0;
  for (const item of listed.objects) {
    const object = await env.MAILBOX_OBJECTS.get(item.key);
    if (!object) continue;
    const metadata = object.customMetadata ?? {};
    const id = item.key.slice("pending/".length, -".eml".length);
    const raw = new Uint8Array(await object.arrayBuffer());
    const envelope = {
        from: metadata.from ?? "", to: metadata.to ?? env.MAILBOX_ADDRESS, receivedAt: metadata.receivedAt ?? new Date().toISOString()
      };
    try {
      await indexPending(env, item.key, id, raw, envelope);
      recovered++;
    } catch {
      console.warn("mailbox_recovery_failed", { id, status: "retryable" });
    }
  }
  if (listed.truncated && listed.cursor) await env.MAILBOX_OBJECTS.put("_control/recovery-cursor", listed.cursor);
  else await env.MAILBOX_OBJECTS.delete("_control/recovery-cursor");
  console.log("mailbox_recovery_complete", { scanned: listed.objects.length, recovered });
}
