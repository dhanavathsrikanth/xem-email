import { authenticate } from "./auth";
import { Env, ingest, MAX_RAW_SIZE, readBounded, recoverPending } from "./storage";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const missing = () => new Response("Not found", { status: 404 });

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/mailbox/")) return missing();
  const body = request.method === "PATCH" ? await readBounded(request.body ?? new Blob([]).stream(), 16 * 1024) : new Uint8Array();
  if (!await authenticate(request, env.MAILBOX_API_SECRET, body)) return new Response("Unauthorized", { status: 401 });
  const bucket = Math.floor(Date.now() / 60000);
  const count = await env.MAILBOX_DB.prepare("INSERT INTO api_rate_limits(bucket,requests) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET requests=requests+1 RETURNING requests").bind(bucket).first<{requests:number}>();
  if ((count?.requests ?? 301) > 300) return json({ error: "rate_limited" }, 429);
  if (bucket % 10 === 0) await env.MAILBOX_DB.prepare("DELETE FROM api_rate_limits WHERE bucket < ?").bind(bucket - 10).run();
  const state = await env.MAILBOX_DB.prepare("SELECT uid_validity,total_emails,latest_uid FROM mailbox_state WHERE id=1").first<{uid_validity:number;total_emails:number;latest_uid:number}>();
  if (!state) return json({ error: "mailbox_not_ready" }, 503);
  const uidValidity = state.uid_validity;
  if (request.method === "GET" && url.pathname === "/v1/mailbox/identity") return json({ version: 1, address: env.MAILBOX_ADDRESS });
  if (request.method === "GET" && url.pathname === "/v1/mailbox/folders") return json([{ Name: "INBOX", Attributes: [] }]);
  if (request.method === "PATCH" && url.pathname === "/v1/mailbox/flags") {
    let input: { folder?: unknown; uid?: unknown; uidValidity?: unknown; flag?: unknown; enabled?: unknown };
    try { input = JSON.parse(new TextDecoder().decode(body)); } catch { return json({ error: "invalid_json" }, 400); }
    if (input.folder !== "INBOX" || !Number.isInteger(input.uid) || Number(input.uid) < 1 || !Number.isInteger(input.uidValidity)) return json({ error: "invalid_uid" }, 400);
    if (Number(input.uidValidity) !== uidValidity) return json({ error: "uid_validity_changed" }, 409);
    if ((input.flag !== "\\Seen" && input.flag !== "\\Flagged") || typeof input.enabled !== "boolean") return json({ error: "invalid_flags" }, 400);
    const column = input.flag === "\\Seen" ? "seen" : "flagged";
    const changed = await env.MAILBOX_DB.prepare(`UPDATE messages SET ${column}=? WHERE uid=? AND folder='INBOX'`).bind(input.enabled ? 1 : 0, input.uid).run();
    if (changed.meta.changes !== 1) return missing();
    return new Response(null, { status: 204 });
  }
  const folder = url.searchParams.get("folder") ?? "INBOX";
  if (folder !== "INBOX") return json({ error: "invalid_folder" }, 400);
  const q = url.searchParams.get("q") ?? "";
  const search = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : "%";
  if (new TextEncoder().encode(search).byteLength > 50) return json({ error: "query_too_long" }, 400);
  const filter = "folder=? AND (subject LIKE ? ESCAPE '\\' OR header_from LIKE ? ESCAPE '\\' OR header_to LIKE ? ESCAPE '\\' OR message_id LIKE ? ESCAPE '\\')";
  if (request.method === "GET" && url.pathname === "/v1/mailbox/head") {
    if (!q) return json({ total_emails: state.total_emails, uidValidity, latest_uid: state.latest_uid });
    const row = await env.MAILBOX_DB.prepare(`SELECT COUNT(*) total,MAX(uid) head_uid FROM messages WHERE ${filter}`).bind(folder,search,search,search,search).first();
    return json({ total_emails: Number(row?.total ?? 0), uidValidity, latest_uid: Number(row?.head_uid ?? 0) });
  }
  if (request.method === "GET" && url.pathname === "/v1/mailbox/emails") {
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const before = url.searchParams.get("before_uid");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000 || (before && (!/^\d+$/.test(before) || Number(before) < 1))) return json({ error: "invalid_pagination" }, 400);
    const cursor = before ? " AND uid < ?" : "";
    const where = q ? filter : "folder=?";
    const args: unknown[] = q ? [folder,search,search,search,search] : [folder]; if (before) args.push(Number(before)); args.push(limit + 1, offset);
    const result = await env.MAILBOX_DB.prepare(`SELECT * FROM messages WHERE ${where}${cursor} ORDER BY uid DESC LIMIT ? OFFSET ?`).bind(...args).all<Record<string,unknown>>();
    const rows = result.results.slice(0, limit);
    const total = q ? Number((await env.MAILBOX_DB.prepare(`SELECT COUNT(*) total FROM messages WHERE ${filter}`).bind(folder,search,search,search,search).first<{total:number}>())?.total ?? 0) : state.total_emails;
    return json({ folder_name: folder, total_emails: total, limit, offset, uidValidity,
      next_before_uid: result.results.length > limit ? Number(rows.at(-1)?.uid) : undefined, emails: rows.map((row) => message(row, uidValidity)) });
  }
  const uid = Number(url.searchParams.get("uid"));
  const suppliedValidity = Number(url.searchParams.get("uidValidity") ?? url.searchParams.get("uid_validity"));
  if (!Number.isInteger(uid) || uid < 1 || !Number.isInteger(suppliedValidity)) return json({ error: "invalid_uid" }, 400);
  if (suppliedValidity !== uidValidity) return json({ error: "uid_validity_changed" }, 409);
  const row = await env.MAILBOX_DB.prepare("SELECT * FROM messages WHERE folder=? AND uid=?").bind(folder, uid).first<Record<string,unknown>>();
  if (!row) return missing();
  if (request.method === "GET" && url.pathname === "/v1/mailbox/message") {
    const bodyObject = await env.MAILBOX_OBJECTS.get(String(row.body_key));
    if (!bodyObject) return json({ error: "message_content_unavailable" }, 503);
    const attachmentRows = await env.MAILBOX_DB.prepare("SELECT filename,mime_type,object_key FROM attachments WHERE message_id=? ORDER BY position").bind(row.id).all<{filename:string;mime_type:string;object_key:string}>();
    const bodyValue = await bodyObject.json<{text:string;html:string}>();
    const attachments: Array<{Filename:string;MIMEType:string;Data:string}> = [];
    let encodedBytes = new TextEncoder().encode(bodyValue.html || bodyValue.text).byteLength;
    for (const item of attachmentRows.results) {
      const object = await env.MAILBOX_OBJECTS.get(item.object_key);
      if (!object) return json({ error: "message_content_unavailable" }, 503);
      const bytes = new Uint8Array(await object.arrayBuffer());
      encodedBytes += Math.ceil(bytes.byteLength / 3) * 4;
      if (encodedBytes > 11 * 1024 * 1024) return json({ error: "message_too_large_for_api" }, 413);
      let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
      attachments.push({ Filename: item.filename, MIMEType: item.mime_type, Data: btoa(binary) });
    }
    return json(message(row, uidValidity, bodyValue, attachments));
  }
  return missing();
}

function escapeHTML(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function message(row: Record<string, unknown>, uidValidity: number, body?: {text:string;html:string}, fullAttachments?: unknown[]) {
  const flags = [...(Number(row.seen) ? ["\\Seen"] : []), ...(Number(row.flagged) ? ["\\Flagged"] : [])];
  const visibleBody = body ? (body.html || `<pre>${escapeHTML(body.text)}</pre>`) : `<pre>${escapeHTML(String(row.body_preview))}</pre>`;
  return { id: row.id, uid: Number(row.uid), uidValidity, body: visibleBody, flags, to: row.header_to, cc: row.header_cc, bcc: row.header_bcc,
    from: row.header_from, subject: row.subject, date: row.sent_at, messageId: row.message_id, message_id: row.message_id,
    attachments: fullAttachments ?? JSON.parse(String(row.attachment_json)), reply_to: row.reply_to };
}

export default {
  async fetch(request: Request, env: Env) { try { return await api(request, env); } catch (error) { console.error("mailbox_api_error", { status: "internal_error" }); return json({ error: "internal_error" }, 500); } },
  async email(message: ForwardableEmailMessage, env: Env) {
    if (message.to.trim().toLowerCase() !== env.MAILBOX_ADDRESS.trim().toLowerCase()) { message.setReject("Mailbox recipient mismatch"); return; }
    if (message.rawSize > MAX_RAW_SIZE) { message.setReject("Message exceeds 10 MiB limit"); return; }
    try { await ingest(env, { from: message.from, to: message.to, receivedAt: new Date().toISOString() }, await readBounded(message.raw, MAX_RAW_SIZE)); }
    catch (error) { if (error instanceof Error && error.message === "payload_too_large") message.setReject("Message exceeds 10 MiB limit"); else throw error; }
  },
  async scheduled(_controller: ScheduledController, env: Env) { await recoverPending(env); }
} satisfies ExportedHandler<Env>;
