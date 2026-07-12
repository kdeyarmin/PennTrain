export const STRIPE_API_VERSION = "2026-02-25.clover";
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function phase2BillingSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function phase2BillingHmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(signature));
}

export function phase2BillingConstantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

export interface StripeSignatureResult {
  valid: boolean;
  timestamp: number | null;
  reason?: "missing" | "malformed" | "replay_window" | "signature";
}

export async function verifyPhase2StripeSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): Promise<StripeSignatureResult> {
  if (!signatureHeader || !webhookSecret) return { valid: false, timestamp: null, reason: "missing" };
  const values = signatureHeader.split(",").map((part) => part.trim());
  const timestampText = values.find((part) => part.startsWith("t="))?.slice(2);
  const timestamp = Number(timestampText);
  const signatures = values.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || signatures.length === 0) {
    return { valid: false, timestamp: null, reason: "malformed" };
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { valid: false, timestamp, reason: "replay_window" };
  }
  const expected = await phase2BillingHmac(webhookSecret, `${timestamp}.${rawBody}`);
  const valid = signatures.some((candidate) => phase2BillingConstantTimeEqual(candidate, expected));
  return valid ? { valid: true, timestamp } : { valid: false, timestamp, reason: "signature" };
}

type StripeFormValue = string | number | boolean | null | undefined | StripeFormValue[] | {
  [key: string]: StripeFormValue;
};

function appendStripeValue(form: URLSearchParams, key: string, value: StripeFormValue): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendStripeValue(form, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([childKey, child]) => {
      appendStripeValue(form, key ? `${key}[${childKey}]` : childKey, child);
    });
    return;
  }
  form.append(key, String(value));
}

export function buildPhase2StripeForm(values: Record<string, StripeFormValue>): URLSearchParams {
  const form = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => appendStripeValue(form, key, value));
  return form;
}

export async function phase2StripePost(
  path: string,
  secretKey: string,
  values: Record<string, StripeFormValue>,
  idempotencyKey?: string,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey.slice(0, 255) } : {}),
    },
    body: buildPhase2StripeForm(values),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

export function phase2BillingStateForStripeStatus(
  status: string,
  eventCreatedAtSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): "trial" | "active" | "grace" | "past_due" | "canceled" | "suspended" {
  if (status === "trialing") return "trial";
  if (status === "active") return "active";
  if (status === "past_due") return eventCreatedAtSeconds + 7 * 86400 > nowSeconds ? "grace" : "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  if (status === "paused") return "suspended";
  return "past_due";
}

export function phase2ProviderEventIsNewer(
  incomingCreatedAt: string,
  incomingId: string,
  storedCreatedAt: string | null,
  storedId: string | null,
): boolean {
  if (!storedCreatedAt) return true;
  const incoming = Date.parse(incomingCreatedAt);
  const stored = Date.parse(storedCreatedAt);
  return incoming > stored || (incoming === stored && incomingId > (storedId ?? ""));
}

export function validatePhase2BillingReturnUrl(
  candidate: string,
  requestOrigin: string | null,
  configuredOrigins: string[],
): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return false;
    }
    const allowed = new Set(configuredOrigins.map((origin) => new URL(origin).origin));
    if (requestOrigin) allowed.add(new URL(requestOrigin).origin);
    return allowed.has(url.origin);
  } catch {
    return false;
  }
}
