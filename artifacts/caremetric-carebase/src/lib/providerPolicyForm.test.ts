import { describe, it, expect } from 'vitest';
import { providerIntent, providerPatchFromForm, PROVIDER_FORM_FIELDS, type ProviderForm } from './providerPolicyForm';
import type { ProviderContext } from '../../../../supabase/functions/_shared/learningProviderPolicy';
const context: ProviderContext = { courseId: 'abc00000-0000-4000-8000-000000000001', courseTitle: 'Course', courseStatus: 'draft', providerContextRevision: 'a'.repeat(64),
  impact: { versionCount: '2', legacyFallbackCertificates: '3', governedDrafts: [] }, profile: { id: 'abc00000-0000-4000-8000-000000000002', providerFullName: ' Provider legacy ', courseAuthor: null, signatureName: 'Typed name', signatureRecordedAt: '2026-09-11T00:00:00Z', contentVersion: null, lastClinicalReviewDate: null, reviewedBy: null, nextReviewDue: null, regulationReviewDate: null, reviewNotes: 'x'.repeat(14000) } };
const form = (): ProviderForm => Object.fromEntries(Object.entries(PROVIDER_FORM_FIELDS).map(([input, field]) => [input, context.profile![field] ?? ''])) as ProviderForm;
describe('provider form intent', () => {
  it('preserves untouched legacy text and server-owned signature evidence', () => {
    const value = form(); value.course_author = 'New author';
    expect(providerPatchFromForm(context, value)).toEqual({ courseAuthor: 'New author' });
  });
  it('clearing a signature is explicit and never supplies a timestamp', () => {
    const value = form(); value.provider_signature_name = '';
    expect(providerPatchFromForm(context, value)).toEqual({ signatureName: null });
  });
  it('keeps exact uncertain retry identity while changing inputs creates a new request', () => {
    const first = providerIntent(null, { revision: 'a', patch: { courseAuthor: 'A' } }, () => 'one');
    expect(providerIntent(first, { revision: 'a', patch: { courseAuthor: 'A' } }, () => 'two')).toBe(first);
    expect(providerIntent(first, { revision: 'a', patch: { courseAuthor: 'B' } }, () => 'two').requestId).toBe('two');
  });
  it('rejects a no-op and impossible calendar date without normalizing the old record', () => {
    expect(() => providerPatchFromForm(context, form())).toThrow();
    const value = form(); value.next_review_due = '2025-02-29'; expect(() => providerPatchFromForm(context, value)).toThrow();
  });
});
