import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
import { executeNativeCreation, nativeCreationIntent, parseCreationResult, type CourseCreationForm } from './governedLearningCreation';
const id = (n: number) => `abc00000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input: CourseCreationForm = { course: { title: 'New course', description: null, category: null, estimatedDurationMinutes: 60, trainingTypeId: null },
  version: { title: 'First draft', description: null } };
const intent = { key: JSON.stringify(input), requestId: id(1), courseId: id(2), versionId: id(3) };
const result = { action: 'learning.createCourse', commandId: id(4), courseId: id(2), versionId: id(3), versionNumber: 1,
  status: 'draft', courseStatus: 'draft', currentVersionId: null, contentStandard: 'comprehensive', sourceRevision: 'a'.repeat(64),
  appliedAt: '2026-09-11T15:00:00Z', replayed: false };
describe('native atomic course creation and recovery', () => {
  beforeEach(() => rpc.mockReset());
  it('retains every creation identity for exact retries and replaces them only for a changed intent', () => {
    let n = 10; const createId = () => id(n++);
    const first = nativeCreationIntent(null, input, createId);
    expect(nativeCreationIntent(first, structuredClone(input), createId)).toBe(first);
    const next = nativeCreationIntent(first, { ...input, version: { ...input.version, title: 'Changed' } }, createId);
    expect(new Set([first.requestId, first.courseId, first.versionId, next.requestId, next.courseId, next.versionId]).size).toBe(6);
  });
  it('creates course plus first draft through exactly one shared native transaction after an absence check', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'absent', result: null }, error: null }).mockResolvedValueOnce({ data: result, error: null });
    await expect(executeNativeCreation(intent, input)).resolves.toMatchObject({ courseId: id(2), versionId: id(3) });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]).toEqual(['execute_native_learning_draft_command', expect.objectContaining({ p_request_id: id(1), p_course_id: id(2),
      p_action: 'learning.createCourse', p_parameters: { ...input, versionId: id(3) } })]);
  });
  it('recovers a successful lost response under a new session without attempting another material write', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', result }, error: null });
    await executeNativeCreation(intent, input);
    expect(rpc).toHaveBeenCalledTimes(1); expect(rpc.mock.calls[0][0]).toBe('get_native_learning_creation_status');
  });
  it('does not try a mutation after conflicting receipt or failed current-authority recovery', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'applied', result: { ...result, courseId: id(9) } }, error: null });
    await expect(executeNativeCreation(intent, input)).rejects.toThrow('did not match'); expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockReset().mockResolvedValue({ data: null, error: new Error('session expired') });
    await expect(executeNativeCreation(intent, input)).rejects.toThrow('session expired'); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects a fake published response, wrong version, and changed reviewed fields', async () => {
    expect(() => parseCreationResult({ ...result, status: 'published' }, intent)).toThrow();
    expect(() => parseCreationResult({ ...result, versionNumber: 2 }, intent)).toThrow();
    await expect(executeNativeCreation(intent, { ...input, version: { ...input.version, title: 'Unreviewed' } })).rejects.toThrow('changed after review');
    expect(rpc).not.toHaveBeenCalled();
  });
});
