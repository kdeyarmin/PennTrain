import { supabase } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import { validCourseCreation, validCreationOptions, type CourseCreation } from '../../../../supabase/functions/_shared/learningCreation';
export type CourseCreationForm = Omit<CourseCreation, 'versionId'>;
export type NativeCreationIntent = { key: string; requestId: string; courseId: string; versionId: string };
const id = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function nativeCreationIntent(previous: NativeCreationIntent | null, value: CourseCreationForm,
  createId: () => string = () => crypto.randomUUID()): NativeCreationIntent {
  const key = JSON.stringify(value);
  return previous?.key === key ? previous : { key, requestId: createId(), courseId: createId(), versionId: createId() };
}
export function parseCreationResult(value: unknown, intent: NativeCreationIntent) {
  if (!object(value) || value.action !== 'learning.createCourse' || value.courseId !== intent.courseId || value.versionId !== intent.versionId
    || typeof value.commandId !== 'string' || !id.test(value.commandId) || value.versionNumber !== 1 || value.status !== 'draft'
    || value.courseStatus !== 'draft' || value.currentVersionId !== null || value.contentStandard !== 'comprehensive'
    || typeof value.sourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.sourceRevision)
    || typeof value.appliedAt !== 'string' || !Number.isFinite(Date.parse(value.appliedAt)) || typeof value.replayed !== 'boolean') {
    throw new Error('Creation receipt did not match this reviewed course. Recover the same request.');
  }
  return { courseId: intent.courseId, versionId: intent.versionId, sourceRevision: value.sourceRevision, replayed: value.replayed };
}
export async function readNativeCreationOptions(offset: number) {
  const { data, error } = await supabase.rpc('get_native_learning_creation_options', { p_offset: offset });
  if (error) throw error;
  if (!validCreationOptions(data) || data.nextOffset !== null && data.nextOffset !== offset + 100) throw new Error('Training type options did not match the requested page.');
  return data;
}
export async function recoverNativeCreation(intent: NativeCreationIntent) {
  const { data, error } = await supabase.rpc('get_native_learning_creation_status', { p_course_id: intent.courseId,
    p_version_id: intent.versionId, p_request_id: intent.requestId });
  if (error) throw error;
  if (!object(data)) throw new Error('Creation recovery did not return a receipt.');
  if (data.status === 'absent' && data.result === null) return null;
  if (data.status !== 'applied') throw new Error('Creation recovery did not return a receipt.');
  return parseCreationResult(data.result, intent);
}
export async function executeNativeCreation(intent: NativeCreationIntent, input: CourseCreationForm) {
  if (intent.key !== JSON.stringify(input)) throw new Error('Creation fields changed after review.');
  const parameters = { versionId: intent.versionId, ...input };
  if (!validCourseCreation(parameters)) throw new Error('Review the course titles, descriptions and duration before creating the draft.');
  const recovered = await recoverNativeCreation(intent);
  if (recovered) return recovered;
  const { data, error } = await supabase.rpc('execute_native_learning_draft_command', { p_request_id: intent.requestId,
    p_action: 'learning.createCourse', p_course_id: intent.courseId, p_parameters: parameters as Json,
    p_reason: 'Administrator reviewed the new course and first draft definitions' });
  if (error) throw error;
  return parseCreationResult(data, intent);
}
