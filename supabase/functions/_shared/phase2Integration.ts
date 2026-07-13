export const PHASE2_INTEGRATION_SCHEMA_VERSION = "2026-07-11";
export const PHASE2_INTEGRATION_REPLAY_WINDOW_SECONDS = 300;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function phase2IntegrationSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function phase2IntegrationHmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(result));
}

export function phase2IntegrationConstantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

export async function signPhase2IntegrationWebhook(
  secret: string,
  webhookId: string,
  timestamp: number,
  rawBody: string,
): Promise<string> {
  return phase2IntegrationHmac(secret, `${webhookId}.${timestamp}.${rawBody}`);
}

export async function verifyPhase2IntegrationWebhook(input: {
  secret: string;
  webhookId: string;
  timestamp: number;
  rawBody: string;
  signature: string;
  nowSeconds?: number;
}): Promise<boolean> {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestamp) > PHASE2_INTEGRATION_REPLAY_WINDOW_SECONDS) return false;
  const expected = await signPhase2IntegrationWebhook(
    input.secret,
    input.webhookId,
    input.timestamp,
    input.rawBody,
  );
  const supplied = input.signature.startsWith("v1=") ? input.signature.slice(3) : input.signature;
  return phase2IntegrationConstantTimeEqual(expected, supplied);
}

export function parsePhase2ApiCredential(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer\s+(ccb_live_[0-9a-f]{12}\.[0-9a-f]{64})$/i);
  return match?.[1] ?? null;
}

export function phase2CredentialIsUsable(input: {
  status: string;
  expiresAt: string;
  scopes: string[];
  requiredScope: string;
}, now = Date.now()): boolean {
  return input.status === "active" && Date.parse(input.expiresAt) > now && input.scopes.includes(input.requiredScope);
}

export function encodePhase2Cursor(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid cursor sequence");
  return btoa(`v1:${sequence}`).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodePhase2Cursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const padded = cursor.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((cursor.length + 3) % 4);
    const decoded = atob(padded);
    const match = decoded.match(/^v1:([0-9]+)$/);
    const sequence = Number(match?.[1]);
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error();
    return sequence;
  } catch {
    throw new Error("Invalid cursor");
  }
}

export function phase2RetryableWebhookStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function phase2IntegrationHeaders(
  correlationId: string,
  rate?: { limit: number; remaining: number; resetAt: string },
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Version": PHASE2_INTEGRATION_SCHEMA_VERSION,
    "X-Correlation-Id": correlationId,
    Deprecation: "false",
    ...(rate
      ? {
        "RateLimit-Limit": String(rate.limit),
        "RateLimit-Remaining": String(rate.remaining),
        "RateLimit-Reset": String(Math.floor(Date.parse(rate.resetAt) / 1000)),
      }
      : {}),
  };
}

export function sanitizePhase2IntegrationError(value: unknown, maxLength = 500): string {
  const text = value instanceof Error ? value.message : String(value ?? "Unknown error");
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function phase2PublicIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}

function phase2PublicIp(value: string): boolean {
  const address = value.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (/^[0-9.]+$/.test(address)) return phase2PublicIpv4(address);
  if (!address.includes(":")) return false;
  if (address === "::" || address === "::1" || address.startsWith("fc") || address.startsWith("fd") ||
    /^fe[89ab]/.test(address) || address.startsWith("ff") || address.startsWith("100:") ||
    address.startsWith("64:ff9b:1:") || address.startsWith("2001:2:") ||
    address.startsWith("2001:10:") || address.startsWith("2001:db8:")) return false;
  if (address.startsWith("::ffff:")) return phase2PublicIpv4(address.slice(7));
  return /^[0-9a-f:]+$/.test(address);
}

export type Phase2DnsResolver = (hostname: string, recordType: "A" | "AAAA") => Promise<string[]>;

export async function validatePhase2WebhookDestination(
  value: string,
  resolver: Phase2DnsResolver = (hostname, recordType) => Deno.resolveDns(hostname, recordType),
): Promise<{ valid: boolean; reason?: string; addresses?: string[] }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { valid: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
    url.href.length > 2048 || url.hash) return { valid: false, reason: "unsafe_url" };
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { valid: false, reason: "unsafe_hostname" };
  }
  if (/^[0-9.]+$/.test(hostname) || hostname.includes(":")) {
    return phase2PublicIp(hostname)
      ? { valid: true, addresses: [hostname] }
      : { valid: false, reason: "non_public_address" };
  }
  const results = await Promise.allSettled([
    resolver(hostname, "A"),
    resolver(hostname, "AAAA"),
  ]);
  const addresses = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!addresses.length) return { valid: false, reason: "dns_resolution_failed" };
  if (addresses.some((address) => !phase2PublicIp(address))) {
    return { valid: false, reason: "non_public_address", addresses };
  }
  return { valid: true, addresses };
}
