const encoder = new TextEncoder();

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export async function sha256(value: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : Uint8Array.from(new Uint8Array(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function canonical(method: string, pathAndQuery: string, timestamp: string, bodyHash: string): string {
  return `v1\n${method.toUpperCase()}\n${pathAndQuery}\n${timestamp}\n${bodyHash}`;
}

export async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function decodeBase64url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch { return null; }
}

export async function authenticate(request: Request, secret: string, body: Uint8Array, now = Date.now()): Promise<boolean> {
  if (secret.length < 32 || secret.length > 4096) return false;
  const timestamp = request.headers.get("X-Xem-Mailbox-Timestamp") ?? "";
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) return false;
  const suppliedHash = request.headers.get("X-Xem-Mailbox-Content-SHA256") ?? "";
  const actualHash = await sha256(body);
  if (suppliedHash !== actualHash) return false;
  const url = new URL(request.url);
  const signature = decodeBase64url(request.headers.get("X-Xem-Mailbox-Signature") ?? "");
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, Uint8Array.from(signature), encoder.encode(canonical(request.method, `${url.pathname}${url.search}`, timestamp, actualHash)));
}

export async function stableId(parts: string[]): Promise<string> {
  const digest = await sha256(parts.join("\n"));
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
