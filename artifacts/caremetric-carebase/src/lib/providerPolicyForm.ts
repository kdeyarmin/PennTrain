import { PROVIDER_FIELDS, validProviderPatch, type ProviderContext, type ProviderField, type ProviderPatch } from '../../../../supabase/functions/_shared/learningProviderPolicy';
export const PROVIDER_FORM_FIELDS = { provider_full_name: 'providerFullName', course_author: 'courseAuthor', provider_signature_name: 'signatureName', content_version: 'contentVersion', last_clinical_review_date: 'lastClinicalReviewDate', reviewed_by: 'reviewedBy', next_review_due: 'nextReviewDue', regulation_review_date: 'regulationReviewDate', review_notes: 'reviewNotes' } as const;
export type ProviderForm = Record<keyof typeof PROVIDER_FORM_FIELDS, string>;
export function providerPatchFromForm(context: ProviderContext, form: ProviderForm): ProviderPatch {
  const patch: ProviderPatch = {};
  for (const [input, field] of Object.entries(PROVIDER_FORM_FIELDS)) {
    const raw = form[input as keyof ProviderForm];
    if (raw === (context.profile?.[field] ?? '')) continue;
    const value = raw.trim() === '' ? null : field === 'reviewNotes' ? raw : raw.trim();
    // Sparse fields preserve untouched legacy content, even outside current input bounds.
    if ((context.profile?.[field] ?? null) !== value) patch[field] = value;
  }
  if (!validProviderPatch(patch)) throw new Error('Enter at least one valid change; names, dates and review notes must fit the shown field limits.');
  return patch;
}
export function providerIntent(previous: { key: string; requestId: string } | null, value: unknown, createId = () => crypto.randomUUID()) {
  const key = JSON.stringify(value); return previous?.key === key ? previous : { key, requestId: createId() };
}
export const PROVIDER_LABELS: Record<ProviderField, string> = Object.fromEntries(PROVIDER_FIELDS.map(field => [field, ({ providerFullName: 'Provider full name', courseAuthor: 'Course author', signatureName: 'Typed signature', contentVersion: 'Content version', lastClinicalReviewDate: 'Last clinical review date', reviewedBy: 'Reviewed by', nextReviewDue: 'Next review due', regulationReviewDate: 'Regulation review date', reviewNotes: 'Review notes' })[field]])) as Record<ProviderField, string>;
