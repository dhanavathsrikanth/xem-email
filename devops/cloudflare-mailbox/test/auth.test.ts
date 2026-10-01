import { describe, expect, it } from "vitest";
import { authenticate, canonical, EMPTY_SHA256, sign, stableId } from "../src/auth";

describe("mailbox request authentication", () => {
  it("matches the backend interoperability vector", async () => {
    const value = canonical("GET", "/v1/mailbox/emails?folder=INBOX&limit=20&offset=0", "1790764200", EMPTY_SHA256);
    expect(await sign("xem-relay-fixture-secret-v1-2026", value)).toBe("XWjZdGs4iMkM5cG5Xzz4BHOyEP1N-n7gw_zXoFI9A2M");
  });

  it("rejects stale, weak, or digest-mismatched requests", async () => {
    const timestamp = "1790764200";
    const url = "https://mail.example/v1/mailbox/identity";
    const signature = await sign("12345678901234567890123456789012", canonical("GET", "/v1/mailbox/identity", timestamp, EMPTY_SHA256));
    const request = new Request(url, { headers: { "X-Xem-Mailbox-Timestamp": timestamp, "X-Xem-Mailbox-Content-SHA256": EMPTY_SHA256, "X-Xem-Mailbox-Signature": signature } });
    expect(await authenticate(request, "12345678901234567890123456789012", new Uint8Array(), 1790764200_000)).toBe(true);
    expect(await authenticate(request, "short", new Uint8Array(), 1790764200_000)).toBe(false);
    expect(await authenticate(request, "12345678901234567890123456789012", new TextEncoder().encode("x"), 1790764200_000)).toBe(false);
    expect(await authenticate(request, "12345678901234567890123456789012", new Uint8Array(), 1790764601_000)).toBe(false);
  });

  it("derives stable UUID-shaped ids", async () => {
    expect(await stableId(["a", "b"])).toBe(await stableId(["a", "b"]));
    expect(await stableId(["a", "b"])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
