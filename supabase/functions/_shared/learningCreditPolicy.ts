// Definition changes only. Completion evidence keeps its existing native writer.
export type CreditDefinition = { creditId: string; trainingTypeId: string; topicCode: string; creditHours: string;
  creditMode: 'automatic' | 'verified_only'; citationNote: string; isActive: boolean };
export type CreditEntry = CreditDefinition | { creditId: string; preserve: true };
export type CreditPolicyChange = { policy: { versionLabel?: string | null; creditedDurationRationale?: string | null };
  credits: CreditEntry[]; removedCreditIds: string[] };
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EXCLUDED = /([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_?token|refresh_?token|service_?role_?key|authorization|password|client_?secret|storage_?(path|bucket)|video_?url|playback_?(url|token)|signed_?url|api_?key|token|secret|secret_?key|signing_?secret)"\s*:)/i;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const prose = (v: unknown, minimum: number) => typeof v === 'string' && v.trim().length >= minimum && v.length <= 12000 && !/\p{Cc}/u.test(v.replace(/[\r\n\t]/g, ''));
export function validCreditPolicyChange(value: unknown): value is CreditPolicyChange {
  if (!exact(value, ['policy', 'credits', 'removedCreditIds']) || !object(value.policy)
    || Object.keys(value.policy).some(key => !['versionLabel', 'creditedDurationRationale'].includes(key))
    || Object.hasOwn(value.policy, 'versionLabel') && value.policy.versionLabel !== null && (typeof value.policy.versionLabel !== 'string'
      || value.policy.versionLabel !== value.policy.versionLabel.trim() || value.policy.versionLabel.length < 1 || value.policy.versionLabel.length > 300 || /\p{Cc}/u.test(value.policy.versionLabel))
    || Object.hasOwn(value.policy, 'creditedDurationRationale') && value.policy.creditedDurationRationale !== null && !prose(value.policy.creditedDurationRationale, 40)
    || !Array.isArray(value.credits) || value.credits.length > 100 || !Array.isArray(value.removedCreditIds) || value.removedCreditIds.length > 100
    || !value.removedCreditIds.every(id)) return false;
  for (const row of value.credits) {
    if (exact(row, ['creditId', 'preserve']) && id(row.creditId) && row.preserve === true) continue;
    if (!exact(row, ['creditId', 'trainingTypeId', 'topicCode', 'creditHours', 'creditMode', 'citationNote', 'isActive'])
      || !id(row.creditId) || !id(row.trainingTypeId) || typeof row.topicCode !== 'string' || row.topicCode.length > 128 || !/^[A-Z0-9][A-Z0-9._-]*$/.test(row.topicCode)
      || typeof row.creditHours !== 'string' || !/^(?:0|[1-9]\d{0,3})\.\d{2}$/.test(row.creditHours) || row.creditHours === '0.00'
      || !['automatic', 'verified_only'].includes(row.creditMode as string) || !prose(row.citationNote, 1) || typeof row.isActive !== 'boolean') return false;
  }
  const allIds = [...value.credits.map(row => row.creditId as string), ...value.removedCreditIds];
  const types = value.credits.filter(row => Object.hasOwn(row, 'trainingTypeId')).map(row => (row.trainingTypeId as string).toLowerCase());
  const serialized = JSON.stringify(value);
  return new Set(allIds.map(v => v.toLowerCase())).size === allIds.length && new Set(types).size === types.length
    && new TextEncoder().encode(serialized).byteLength <= 24576 && !EXCLUDED.test(serialized);
}
