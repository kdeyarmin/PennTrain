import { createHmac } from "node:crypto";

/**
 * Derives the current 30-second TOTP code for a base32 authenticator secret (RFC 6238, SHA-1,
 * 6 digits) -- the same algorithm Supabase's `auth.mfa.enroll({ factorType: "totp" })` secret is
 * meant to be fed into.
 *
 * Shared by resident-lifecycle.spec.ts and role-routing.spec.ts, which both step an org-admin
 * session up through the same "Authenticator code" verify flow.
 */
export function totpCode(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/u, "")) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Authenticator secret is not valid base32");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, "0");
}
