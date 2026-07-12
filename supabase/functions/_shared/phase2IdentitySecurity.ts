const encoder = new TextEncoder();

export interface ScimCredential {
  connectionKey: string;
  secret: string;
}

export function parseScimAuthorization(value: string | null): ScimCredential | null {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;
  const connectionKey = token.slice(0, separator).toLowerCase();
  const secret = token.slice(separator + 1);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      connectionKey,
    ) || secret.length < 24 || secret.length > 512
  ) return null;
  return { connectionKey, secret };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashScimSecret(salt: string, secret: string): Promise<string> {
  return await sha256Hex(`${salt}:${secret}`);
}

// Compares every byte and folds length into the result. Never use === for a
// credential digest, because an early-exit comparison leaks prefix timing.
export function constantTimeEqualHex(actual: string, expected: string): boolean {
  const actualBytes = encoder.encode(actual.toLowerCase());
  const expectedBytes = encoder.encode(expected.toLowerCase());
  let difference = actualBytes.length ^ expectedBytes.length;
  const length = Math.max(actualBytes.length, expectedBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return difference === 0;
}
