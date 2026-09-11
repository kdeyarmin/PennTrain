import { validCreditPolicyChange, type CreditDefinition, type CreditPolicyChange } from '../../../../supabase/functions/_shared/learningCreditPolicy';
import type { GovernedDraftSource } from './governedLearningDraft';
export type CreditPolicySource = { versionLabel: string | null; creditedDurationRationale: string | null; credits: CreditDefinition[] };
export type CreditPolicyForm = { versionLabel: string; creditedDurationRationale: string; credits: CreditDefinition[] };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
export function canonicalCreditHours(value: string): string {
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(value)) return value;
  const [whole, fraction = ''] = value.split('.'); return `${whole}.${fraction.padEnd(2, '0')}`;
}
export function readCreditPolicySource(source: GovernedDraftSource): CreditPolicySource | null {
  const data: unknown = JSON.parse(source.payload);
  if (!object(data) || !object(data.version) || !(data.version.label === null || typeof data.version.label === 'string')
    || !(data.version.creditedDurationRationale === null || typeof data.version.creditedDurationRationale === 'string') || !Array.isArray(data.credits) || data.credits.length > 100) return null;
  const credits: CreditDefinition[] = [];
  for (const row of data.credits) {
    if (!object(row) || !uuid(row.id) || !uuid(row.trainingTypeId) || typeof row.topicCode !== 'string' || typeof row.creditHours !== 'string'
      || !['automatic', 'verified_only'].includes(row.mode as string) || typeof row.citationNote !== 'string' || typeof row.active !== 'boolean') return null;
    credits.push({ creditId: row.id, trainingTypeId: row.trainingTypeId, topicCode: row.topicCode, creditHours: canonicalCreditHours(row.creditHours),
      creditMode: row.mode as CreditDefinition['creditMode'], citationNote: row.citationNote, isActive: row.active });
  }
  if (new Set(credits.map(row => row.creditId.toLowerCase())).size !== credits.length) return null;
  return { versionLabel: data.version.label, creditedDurationRationale: data.version.creditedDurationRationale, credits };
}
export const creditPolicyForm = (source: CreditPolicySource): CreditPolicyForm => ({ versionLabel: source.versionLabel ?? '',
  creditedDurationRationale: source.creditedDurationRationale ?? '', credits: source.credits.map(row => ({ ...row })) });
export function creditPolicyChange(source: CreditPolicySource, form: CreditPolicyForm): CreditPolicyChange | null {
  const policy: CreditPolicyChange['policy'] = {};
  const label = form.versionLabel.trim() || null, rationale = form.creditedDurationRationale || null;
  if (form.versionLabel !== (source.versionLabel ?? '') && label !== source.versionLabel) policy.versionLabel = label;
  if (form.creditedDurationRationale !== (source.creditedDurationRationale ?? '') && rationale !== source.creditedDurationRationale) policy.creditedDurationRationale = rationale;
  const credits = form.credits.map(row => JSON.stringify(row) === JSON.stringify(source.credits.find(old => old.creditId === row.creditId))
    ? { creditId: row.creditId, preserve: true as const } : row);
  const removedCreditIds = source.credits.filter(row => !form.credits.some(next => next.creditId === row.creditId)).map(row => row.creditId);
  if (!Object.keys(policy).length && !removedCreditIds.length && credits.every(row => 'preserve' in row)) return null;
  return { policy, credits, removedCreditIds };
}
export function validCreditPolicyParameters(source: GovernedDraftSource, change: unknown) {
  return validCreditPolicyChange(change) && new TextEncoder().encode(JSON.stringify({ versionId: source.versionId, sourceRevision: source.sourceRevision, ...change })).byteLength <= 24576;
}
