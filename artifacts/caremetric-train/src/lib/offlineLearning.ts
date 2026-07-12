export const OFFLINE_ALLOWED_DOMAINS = ["course", "course_version", "course_block", "quiz_prompt", "learner_action"] as const;
const BLOCKED_KEYS = /resident|incident|credential|audit|report|employee_list|policy_evidence|admin|access_token|refresh_token|service_role/i;

export interface OfflinePayload { domain: typeof OFFLINE_ALLOWED_DOMAINS[number]; organizationId: string; profileId: string; versionId: string; data: unknown }
export interface EncryptedOfflinePayload { version: 1; iv: string; ciphertext: string; additionalData: string }

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value); const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function containsBlockedKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsBlockedKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => BLOCKED_KEYS.test(key) || containsBlockedKey(nested));
}

export function assertOfflinePayloadAllowed(payload: OfflinePayload): void {
  if (!OFFLINE_ALLOWED_DOMAINS.includes(payload.domain)) throw new Error("Offline domain is not allowlisted");
  if (!payload.organizationId || !payload.profileId || !payload.versionId) throw new Error("Offline payload scope is incomplete");
  if (containsBlockedKey(payload.data)) throw new Error("Offline payload contains a protected domain or secret");
}

export async function generateOfflineDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptOfflinePayload(key: CryptoKey, payload: OfflinePayload): Promise<EncryptedOfflinePayload> {
  assertOfflinePayloadAllowed(payload);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = `${payload.organizationId}:${payload.profileId}:${payload.versionId}`;
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(additionalData) }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { version: 1, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)), additionalData };
}
export async function decryptOfflinePayload(key: CryptoKey, envelope: EncryptedOfflinePayload, expectedScope: string): Promise<OfflinePayload> {
  if (envelope.version !== 1 || envelope.additionalData !== expectedScope) throw new Error("Offline payload scope changed; wipe required");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.iv), additionalData: new TextEncoder().encode(envelope.additionalData) }, key, base64ToBytes(envelope.ciphertext));
  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as OfflinePayload;
  assertOfflinePayloadAllowed(payload);
  return payload;
}

export function shouldWipeOfflineData(previous: { profileId: string; organizationId: string; role: string } | null, current: { profileId: string; organizationId: string; role: string; active: boolean } | null): boolean {
  if (!previous || !current) return previous !== null;
  return !current.active || current.role !== "employee" || previous.profileId !== current.profileId || previous.organizationId !== current.organizationId || previous.role !== current.role;
}
