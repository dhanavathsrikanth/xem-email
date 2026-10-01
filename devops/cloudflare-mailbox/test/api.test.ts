import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { canonical, EMPTY_SHA256, sign } from "../src/auth";

const secret = "12345678901234567890123456789012";
async function signed(path: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request(`https://mail.example${path}`, { headers: {
    "X-Xem-Mailbox-Timestamp": timestamp,
    "X-Xem-Mailbox-Content-SHA256": EMPTY_SHA256,
    "X-Xem-Mailbox-Signature": await sign(secret, canonical("GET", path, timestamp, EMPTY_SHA256))
  } });
}

function environment() {
  const prepare = (query: string) => ({
    bind: (..._values: unknown[]) => ({
      first: async () => query.includes("RETURNING requests") ? { requests: 1 } : query.includes("mailbox_state") ? { uid_validity: 42, total_emails: 0, latest_uid: 0 } : { total: 0, head_uid: null },
      run: async () => ({ meta: { changes: 1 } }),
      all: async () => ({ results: [] })
    }),
    first: async () => query.includes("mailbox_state") ? { uid_validity: 42, total_emails: 0, latest_uid: 0 } : null
  });
  return { MAILBOX_API_SECRET: secret, MAILBOX_ADDRESS: "inbox@example.com", MAILBOX_DB: { prepare }, MAILBOX_OBJECTS: {} } as unknown as Parameters<typeof worker.fetch>[1];
}

describe("signed mailbox API shapes", () => {
  it("returns a versioned identity and IMAP-like folders", async () => {
    const env = environment();
    expect(await (await worker.fetch(await signed("/v1/mailbox/identity"), env)).json()).toEqual({ version: 1, address: "inbox@example.com" });
    expect(await (await worker.fetch(await signed("/v1/mailbox/folders"), env)).json()).toEqual([{ Name: "INBOX", Attributes: [] }]);
  });

  it("returns the exact empty head and list contracts without R2 reads", async () => {
    const env = environment();
    expect(await (await worker.fetch(await signed("/v1/mailbox/head?folder=INBOX&q="), env)).json()).toEqual({ total_emails: 0, uidValidity: 42, latest_uid: 0 });
    expect(await (await worker.fetch(await signed("/v1/mailbox/emails?folder=INBOX&limit=20&offset=0"), env)).json()).toEqual({ folder_name: "INBOX", total_emails: 0, limit: 20, offset: 0, uidValidity: 42, emails: [] });
  });

  it("returns 401 for unsigned access", async () => {
    expect((await worker.fetch(new Request("https://mail.example/v1/mailbox/identity"), environment())).status).toBe(401);
  });
});
