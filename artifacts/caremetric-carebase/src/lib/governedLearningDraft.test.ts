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
  it('reads each intentionally incomplete quiz draft without permitting a published source', async () => {
    for (const quiz of [null, { id: courseId, questions: [] }, { id: courseId, questions: [{ id: versionId, options: [] }] }]) {
      const raw = source({ blocks: [{ id: courseId, type: 'quiz', title: null, body: {}, quiz }] });
      expect((await parseGovernedDraftSource(raw))?.document.blocks[0].quiz).toEqual(quiz);
    }
    await expect(parseGovernedDraftSource(source({ sourceVersionState: 'published', blocks: [{ id: courseId, type: 'quiz', quiz: null }] }))).rejects.toThrow('identity');
  });
  it('submits a complete structure intent with its original source and reuses unchanged retry inputs', async () => {
    const captured = (await parseGovernedDraftSource(source()))!;
    const changes = [{ operation: 'addLesson' as const, blockId: courseId, blockType: 'quiz' as const, title: null, body: {} }];
    rpc.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({ data: { action: 'learning.editStructure', courseId, versionId, status: 'draft',
      versionNumber: 2, sourceRevision: 'b'.repeat(64), replayed: true }, error: null });
    await expect(executeNativeDraft(captured, 'learning.editStructure', 'same-request', 'Reviewed new quiz lesson', changes)).rejects.toThrow('Response lost');
    await expect(executeNativeDraft(captured, 'learning.editStructure', 'same-request', 'Reviewed new quiz lesson', changes)).resolves.toMatchObject({ replayed: true });
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(rpc.mock.calls[0][1].p_parameters).toEqual({ versionId, sourceRevision: captured.sourceRevision, changes });
  });
});

it('credit policy retries the same complete definition request after an uncertain result', async () => {
  rpc.mockReset(); const captured = (await parseGovernedDraftSource(source()))!;
  const change = { policy: { versionLabel: 'Reviewed edition' }, credits: [{ creditId: courseId, preserve: true as const }], removedCreditIds: [] };
  const input = { versionId, sourceRevision: captured.sourceRevision, change, reason: 'Reviewed definition preservation' };
  const initial = nativeDraftIntent(null, input, () => 'same-credit-request');
  rpc.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({ data: { action: 'learning.editCreditPolicy', courseId, versionId,
    status: 'draft', versionNumber: 2, sourceRevision: 'c'.repeat(64), replayed: true }, error: null });
  await expect(executeNativeDraft(captured, 'learning.editCreditPolicy', initial.requestId, input.reason, change)).rejects.toThrow('Response lost');
  const retry = nativeDraftIntent(initial, input, () => 'unwanted-new-request');
  await expect(executeNativeDraft(captured, 'learning.editCreditPolicy', retry.requestId, input.reason, change)).resolves.toMatchObject({ replayed: true });
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
  expect(rpc.mock.calls[0][1].p_parameters).toEqual({ versionId, sourceRevision: captured.sourceRevision, ...change });
  expect(nativeDraftIntent(retry, { ...input, change: { ...change, policy: { versionLabel: 'Different edition' } } }, () => 'new-request').requestId).toBe('new-request');
});
