/** Closed course-wide metadata contract. It records documentation, never provider approval. */
export const PROVIDER_FIELDS = ['providerFullName', 'courseAuthor', 'signatureName', 'contentVersion', 'lastClinicalReviewDate', 'reviewedBy', 'nextReviewDue', 'regulationReviewDate', 'reviewNotes'] as const;
export type ProviderField = typeof PROVIDER_FIELDS[number];
export type ProviderPatch = Partial<Record<ProviderField, string | null>>;
export type ProviderProfile = Record<ProviderField, string | null> & { id: string; signatureRecordedAt: string | null };
export interface ProviderImpact { versionCount: string; legacyFallbackCertificates: string; governedDrafts: { versionId: string; title: string; aiGenerated: boolean; reviewInvalidated: boolean }[] }
export interface ProviderContext { courseId: string; courseTitle: string; courseStatus: 'draft' | 'published' | 'archived'; providerContextRevision: string; profile: ProviderProfile | null; impact: ProviderImpact }
export interface ProviderPreview { commandId: string; courseId: string; action: 'learning.editProviderPolicy'; reason: string; providerContextRevision: string; previewDigest: string; expiresAt: string; changes: { field: ProviderField; before: string | null; after: string | null }[]; signatureTimestampAction: 'retain' | 'record' | 'clear'; impact: ProviderImpact }
export interface ProviderResult { commandId: string; courseId: string; action: 'learning.editProviderPolicy'; providerId: string; providerContextRevision: string; appliedAt: string; replayed: boolean }
export type ProviderOperation = { domain: 'course.provider.v1'; operation: 'context'; courseId: string }
  | { domain: 'course.provider.v1'; operation: 'preview'; requestId: string; courseId: string; providerContextRevision: string; patch: ProviderPatch; reason: string }
  | { domain: 'course.provider.v1'; operation: 'apply' | 'status'; commandId: string; expectedDigest: string }
  | { domain: 'course.provider.v1'; operation: 'commands'; courseId: string; offset: number };
export interface ProviderStatus { preview: ProviderPreview; result: ProviderResult | null; canApplyThisSession: boolean }
export interface ProviderCommands { items: { commandId: string; expectedDigest: string; expiresAt: string; appliedAt: string | null }[]; nextOffset: number | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const CREDENTIALS = /([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_?token|refresh_?token|service_?role_?key|authorization|password|client_?secret|storage_?(path|bucket)|video_?url|playback_?(url|token)|signed_?url|api_?key|token|secret|secret_?key|signing_?secret)"\s*:)/i;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && SHA.test(v);
const text = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v === v.trim() && v.length >= min && v.length <= max && !/\p{Cc}/u.test(v);
export function realProviderDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) || v.startsWith('0000')) return false;
  const date = new Date(v + 'T00:00:00.000Z'); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
}
export function validProviderPatch(v: unknown): v is ProviderPatch {
  if (!object(v) || Object.keys(v).length < 1 || Object.keys(v).some(k => !PROVIDER_FIELDS.includes(k as ProviderField))
    || new TextEncoder().encode(JSON.stringify(v)).byteLength > 24576 || CREDENTIALS.test(JSON.stringify(v))) return false;
  return Object.entries(v).every(([key, value]) => {
    if (value === null) return key !== 'providerFullName';
    if (['lastClinicalReviewDate', 'nextReviewDue', 'regulationReviewDate'].includes(key)) return realProviderDate(value);
    if (key === 'reviewNotes') return typeof value === 'string' && value.length <= 12000 && value.trim().length > 0 && !/[^\P{Cc}\t\r\n]/u.test(value);
    return text(value, 1, key === 'contentVersion' ? 300 : 500);
  });
}
export function validProviderOperation(v: unknown): v is ProviderOperation {
  if (exact(v, ['domain', 'operation', 'courseId']) && v.domain === 'course.provider.v1' && v.operation === 'context') return uuid(v.courseId);
  if (exact(v, ['domain', 'operation', 'commandId', 'expectedDigest']) && v.domain === 'course.provider.v1' && ['apply', 'status'].includes(String(v.operation))) return uuid(v.commandId) && sha(v.expectedDigest);
  if (exact(v, ['domain', 'operation', 'courseId', 'offset']) && v.domain === 'course.provider.v1' && v.operation === 'commands') return uuid(v.courseId) && Number.isSafeInteger(v.offset) && Number(v.offset) >= 0 && Number(v.offset) <= 10000;
  return exact(v, ['domain', 'operation', 'requestId', 'courseId', 'providerContextRevision', 'patch', 'reason']) && v.domain === 'course.provider.v1' && v.operation === 'preview'
    && uuid(v.requestId) && uuid(v.courseId) && sha(v.providerContextRevision) && validProviderPatch(v.patch) && text(v.reason, 10, 500);
}
const legacyText = (v: unknown) => v === null || typeof v === 'string' && v.length <= 200000 && !v.includes('\0');
const count = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const instant = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
export function validProviderImpact(v: unknown): v is ProviderImpact {
  return exact(v, ['versionCount', 'legacyFallbackCertificates', 'governedDrafts']) && count(v.versionCount) && count(v.legacyFallbackCertificates)
    && Array.isArray(v.governedDrafts) && v.governedDrafts.length <= 100 && new Set(v.governedDrafts.map(d => object(d) ? String(d.versionId).toLowerCase() : '')).size === v.governedDrafts.length
    && v.governedDrafts.every(d => exact(d, ['versionId', 'title', 'aiGenerated', 'reviewInvalidated']) && uuid(d.versionId) && typeof d.title === 'string' && legacyText(d.title)
      && typeof d.aiGenerated === 'boolean' && typeof d.reviewInvalidated === 'boolean');
}
export function validProviderContext(v: unknown): v is ProviderContext {
  if (!exact(v, ['courseId', 'courseTitle', 'courseStatus', 'providerContextRevision', 'profile', 'impact']) || !uuid(v.courseId) || !sha(v.providerContextRevision)
    || typeof v.courseTitle !== 'string' || !legacyText(v.courseTitle) || !['draft', 'published', 'archived'].includes(String(v.courseStatus)) || !validProviderImpact(v.impact)) return false;
  const p = v.profile;
  return p === null || exact(p, [...PROVIDER_FIELDS, 'id', 'signatureRecordedAt']) && uuid(p.id) && PROVIDER_FIELDS.every(k => legacyText(p[k]))
    && typeof p.providerFullName === 'string' && (p.signatureRecordedAt === null || instant(p.signatureRecordedAt)) && (p.signatureName === null) === (p.signatureRecordedAt === null);
}
export function validProviderPreview(v: unknown): v is ProviderPreview {
  return exact(v, ['commandId', 'courseId', 'action', 'reason', 'providerContextRevision', 'previewDigest', 'expiresAt', 'changes', 'signatureTimestampAction', 'impact'])
    && uuid(v.commandId) && uuid(v.courseId) && v.action === 'learning.editProviderPolicy' && text(v.reason, 10, 500) && sha(v.providerContextRevision) && sha(v.previewDigest)
    && instant(v.expiresAt) && ['retain', 'record', 'clear'].includes(String(v.signatureTimestampAction)) && validProviderImpact(v.impact)
    && Array.isArray(v.changes) && v.changes.length > 0 && v.changes.length <= 9 && new Set(v.changes.map(c => object(c) ? c.field : '')).size === v.changes.length
    && v.changes.every(c => exact(c, ['field', 'before', 'after']) && PROVIDER_FIELDS.includes(c.field as ProviderField) && legacyText(c.before) && c.before !== c.after && validProviderPatch({ [String(c.field)]: c.after }));
}
export function validProviderResult(v: unknown): v is ProviderResult {
  return exact(v, ['commandId', 'courseId', 'action', 'providerId', 'providerContextRevision', 'appliedAt', 'replayed']) && uuid(v.commandId) && uuid(v.courseId)
    && v.action === 'learning.editProviderPolicy' && uuid(v.providerId) && sha(v.providerContextRevision) && instant(v.appliedAt) && typeof v.replayed === 'boolean';
}

export function validProviderStatus(v: unknown): v is ProviderStatus {
  return exact(v, ['preview', 'result', 'canApplyThisSession']) && validProviderPreview(v.preview) && (v.result === null || validProviderResult(v.result)
    && v.result.commandId === v.preview.commandId && v.result.courseId === v.preview.courseId && v.result.replayed === false)
    && typeof v.canApplyThisSession === 'boolean' && (v.result === null || v.canApplyThisSession === false);
}
export function validProviderCommands(v: unknown): v is ProviderCommands {
  return exact(v, ['items', 'nextOffset']) && (v.nextOffset === null || Number.isSafeInteger(v.nextOffset) && Number(v.nextOffset) >= 0 && Number(v.nextOffset) <= 10000)
    && Array.isArray(v.items) && v.items.length <= 20 && new Set(v.items.map(c => object(c) ? c.commandId : '')).size === v.items.length
    && v.items.every(c => exact(c, ['commandId', 'expectedDigest', 'expiresAt', 'appliedAt']) && uuid(c.commandId) && sha(c.expectedDigest) && instant(c.expiresAt) && (c.appliedAt === null || instant(c.appliedAt)));
}
