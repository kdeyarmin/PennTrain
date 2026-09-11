import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
import { executeNativeDraft, nativeDraftIntent, parseGovernedDraftSource } from './governedLearningDraft';

const courseId = 'a0000000-0000-4000-8000-000000000001';
const versionId = 'a0000000-0000-4000-8000-000000000002';
const source = (changes = {}) => {
  const payload = JSON.stringify({ contract: 'carebase.course.v1', sourceCourseId: courseId, sourceVersionId: versionId,
    sourceVersionState: 'draft', sourceVersionNumber: 2,
    version: { title: 'Reviewed draft', description: null, aiGenerated: true, aiReviewedAt: null },
    blocks: [{ id: 'a0000000-0000-4000-8000-000000000003', type: 'text', title: 'Lesson', body: { content: 'Actual source', nativePolicy: { preserved: true } } }], ...changes });
  return { courseId, versionId, payload, sourceRevision: createHash('sha256').update(payload).digest('hex') };
};

describe('native governed draft review binding', () => {
  beforeEach(() => rpc.mockReset());
  it('checks exact bytes and draft identity before displaying governed source', async () => {
    expect(await parseGovernedDraftSource(null)).toBeNull();
    const raw = source();
    expect((await parseGovernedDraftSource(raw))?.document.blocks[0].body?.nativePolicy).toEqual({ preserved: true });
    await expect(parseGovernedDraftSource({ ...raw, payload: raw.payload + ' ' })).rejects.toThrow('checksum');
    await expect(parseGovernedDraftSource(source({ sourceVersionState: 'published' }))).rejects.toThrow('identity');
    await expect(parseGovernedDraftSource(source({ sourceVersionId: courseId }))).rejects.toThrow('identity');
  });
  it('retains the same request and captured revision after a lost response, then allocates new intent on changes', async () => {
    const captured = (await parseGovernedDraftSource(source()))!;
    const patch = { version: { title: 'Explicit edit' } };
    const intentValue = { versionId, sourceRevision: captured.sourceRevision, patch, reason: 'Reviewed text correction' };
    const initial = nativeDraftIntent(null, intentValue, () => 'request-one');
    rpc.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({ data: {
      action: 'learning.patchDraft', courseId, versionId, status: 'draft', versionNumber: 2,
      sourceRevision: 'b'.repeat(64), replayed: true,
    }, error: null });
    await expect(executeNativeDraft(captured, 'learning.patchDraft', initial.requestId, intentValue.reason, patch)).rejects.toThrow('Response lost');
    const retry = nativeDraftIntent(initial, intentValue, () => 'unexpected-new-request');
    expect(retry).toBe(initial);
    await expect(executeNativeDraft(captured, 'learning.patchDraft', retry.requestId, intentValue.reason, patch)).resolves.toMatchObject({ replayed: true });
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(rpc.mock.calls[0][1].p_parameters.sourceRevision).toBe(captured.sourceRevision);
    expect(nativeDraftIntent(retry, { ...intentValue, sourceRevision: 'c'.repeat(64) }, () => 'request-two').requestId).toBe('request-two');
    expect(nativeDraftIntent(retry, { ...intentValue, patch: { version: { title: 'Another edit' } } }, () => 'request-three').requestId).toBe('request-three');
  });
  it('rejects a cross-version apply response while preserving source for a safe retry', async () => {
    const captured = (await parseGovernedDraftSource(source()))!;
    rpc.mockResolvedValue({ data: { action: 'learning.reviewDraft', courseId, versionId: courseId, versionNumber: 2,
      status: 'draft', sourceRevision: 'b'.repeat(64) }, error: null });
    await expect(executeNativeDraft(captured, 'learning.reviewDraft', 'request', 'Reviewed all definitions')).rejects.toThrow('did not match');
    expect(rpc.mock.calls[0][1].p_parameters).toEqual({ versionId, sourceRevision: captured.sourceRevision, reviewed: true });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_actor');
  });
});
