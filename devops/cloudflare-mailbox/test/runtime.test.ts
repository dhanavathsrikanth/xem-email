import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { canonical, sha256, sign } from "../src/auth";
import type { Env } from "../src/storage";
import { ingest, recoverPending } from "../src/storage";
import fixtureResponse from "./fixtures/worker-response.json";

type TestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as unknown as TestEnv;

beforeEach(async () => {
  await applyD1Migrations(testEnv.MAILBOX_DB, testEnv.TEST_MIGRATIONS);
  await testEnv.MAILBOX_DB.batch([
    testEnv.MAILBOX_DB.prepare("DELETE FROM attachments"), testEnv.MAILBOX_DB.prepare("DELETE FROM messages"),
    testEnv.MAILBOX_DB.prepare("UPDATE mailbox_state SET uid_validity=42,total_emails=0,latest_uid=0 WHERE id=1"), testEnv.MAILBOX_DB.prepare("DELETE FROM api_rate_limits"),
    testEnv.MAILBOX_DB.prepare("DELETE FROM sqlite_sequence WHERE name='messages'")
  ]);
  let cursor: string | undefined;
  do {
    const page = await testEnv.MAILBOX_OBJECTS.list({ cursor });
    await Promise.all(page.objects.map((item) => testEnv.MAILBOX_OBJECTS.delete(item.key)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
});

async function request(path: string, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : new Uint8Array();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = await sha256(body);
  const signature = await sign(testEnv.MAILBOX_API_SECRET, canonical(method, path, timestamp, digest));
  return worker.fetch(new Request(`https://mail.example${path}`, { ...init, headers: {
    "X-Xem-Mailbox-Timestamp": timestamp, "X-Xem-Mailbox-Content-SHA256": digest, "X-Xem-Mailbox-Signature": signature
  } }), testEnv);
}

async function deliver(rawText: string) {
  const raw = new TextEncoder().encode(rawText);
  let rejected = "";
  await worker.email({ from: "sender@example.net", to: "inbox@example.com", rawSize: raw.byteLength,
    raw: new Blob([raw]).stream(), headers: new Headers(), setReject(reason: string) { rejected = reason; }, forward() {} } as unknown as ForwardableEmailMessage, testEnv);
  expect(rejected).toBe("");
}

const fixture = [
  "From: Example Sender <sender@example.net>", "To: inbox@example.com", "Subject: Runtime fixture", "Message-ID: <fixture@example.net>",
  "Date: definitely-invalid", "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="b"', "", "--b",
  "Content-Type: text/plain; charset=utf-8", "", "hello <world>", "--b", "Content-Type: text/plain", "Content-Disposition: attachment; filename=note.txt",
  "Content-Transfer-Encoding: base64", "", "YXR0YWNobWVudA==", "--b--", ""
].join("\r\n");

describe("real D1 and R2 mailbox flow", () => {
  it("ingests, indexes, deduplicates, lists, and returns attachment bytes", async () => {
    const raw = new TextEncoder().encode(fixture);
    const envelope = { from: "sender@example.net", to: "inbox@example.com", receivedAt: "2026-09-30T00:00:00.000Z" };
    await ingest(testEnv, envelope, raw); await ingest(testEnv, envelope, raw);
    expect((await testEnv.MAILBOX_DB.prepare("SELECT COUNT(*) count FROM messages").first<{count:number}>())?.count).toBe(1);
    expect((await testEnv.MAILBOX_DB.prepare("SELECT total_emails,latest_uid FROM mailbox_state WHERE id=1").first<{total_emails:number;latest_uid:number}>())).toMatchObject({ total_emails: 1, latest_uid: 1 });
    const pending = await testEnv.MAILBOX_OBJECTS.list({ prefix: "pending/" }); expect(pending.objects).toHaveLength(0);
    const list = await (await request("/v1/mailbox/emails?folder=INBOX&limit=20&offset=0")).json<any>();
    expect(list).toEqual(fixtureResponse.list);
    const detail = await (await request(`/v1/mailbox/message?folder=INBOX&uid=${list.emails[0].uid}&uid_validity=${list.uidValidity}`)).json<any>();
    expect(detail.from).toBe('"Example Sender" <sender@example.net>');
    expect(detail.attachments[0]).toMatchObject({ Filename: "note.txt", MIMEType: "text/plain", Data: "YXR0YWNobWVudA==" });
    expect(new Date(detail.date).toString()).not.toBe("Invalid Date");
    expect(detail).toEqual(fixtureResponse.detail);
  });

  it("reports head and changes flags independently with stale-UID protection", async () => {
    await deliver(fixture);
    const head = await (await request("/v1/mailbox/head?folder=INBOX&q=")).json<any>();
    expect(head.total_emails).toBe(1); expect(head.latest_uid).toBeGreaterThan(0);
    for (const flag of ["\\Seen", "\\Flagged"]) {
      const body = JSON.stringify({ folder: "INBOX", uid: head.latest_uid, uidValidity: head.uidValidity, flag, enabled: true });
      expect((await request("/v1/mailbox/flags", { method: "PATCH", body })).status).toBe(204);
    }
    expect(await testEnv.MAILBOX_DB.prepare("SELECT seen,flagged FROM messages WHERE uid=?").bind(head.latest_uid).first()).toMatchObject({ seen: 1, flagged: 1 });
    const stale = JSON.stringify({ folder: "INBOX", uid: head.latest_uid, uidValidity: head.uidValidity + 1, flag: "\\Seen", enabled: false });
    expect((await request("/v1/mailbox/flags", { method: "PATCH", body: stale })).status).toBe(409);
  });

  it("keeps a staged message through repeated transient D1 failures and later recovers it", async () => {
    const bytes = new TextEncoder().encode(fixture.replace("<fixture@example.net>", "<recovery@example.net>"));
    const failing = { ...testEnv, MAILBOX_DB: new Proxy(testEnv.MAILBOX_DB, { get(target, property) {
      if (property === "batch") return async () => { throw new Error("simulated_d1_outage"); };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } }) };
    await expect(ingest(failing, { from: "sender@example.net", to: "inbox@example.com", receivedAt: new Date().toISOString() }, bytes)).rejects.toThrow("simulated_d1_outage");
    for (let attempt = 0; attempt < 6; attempt++) await recoverPending(failing);
    expect((await testEnv.MAILBOX_OBJECTS.list({ prefix: "pending/" })).objects).toHaveLength(1);
    expect((await testEnv.MAILBOX_OBJECTS.list({ prefix: "quarantine/" })).objects).toHaveLength(0);
    await recoverPending(testEnv);
    expect((await testEnv.MAILBOX_OBJECTS.list({ prefix: "pending/" })).objects).toHaveLength(0);
    expect((await testEnv.MAILBOX_DB.prepare("SELECT COUNT(*) count FROM messages").first<{count:number}>())?.count).toBe(1);
  });

  it("resets an expired recovery cursor before processing pending mail", async () => {
    const bytes = new TextEncoder().encode(fixture.replace("<fixture@example.net>", "<cursor@example.net>"));
    const failing = { ...testEnv, MAILBOX_DB: new Proxy(testEnv.MAILBOX_DB, { get(target, property) {
      if (property === "batch") return async () => { throw new Error("simulated_d1_outage"); };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } }) };
    await expect(ingest(failing, { from: "sender@example.net", to: "inbox@example.com", receivedAt: "2026-09-30T00:00:00.000Z" }, bytes)).rejects.toThrow();
    await testEnv.MAILBOX_OBJECTS.put("_control/recovery-cursor", "expired-invalid-cursor");
    await recoverPending(testEnv);
    expect((await testEnv.MAILBOX_OBJECTS.list({ prefix: "pending/" })).objects).toHaveLength(0);
  });
});
