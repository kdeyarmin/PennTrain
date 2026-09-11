import { supabase } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import { validStructureChanges, type StructureChange } from '../../../../supabase/functions/_shared/learningStructure';
export type { StructureChange, LessonFields, LessonType, QuizPolicy, QuestionDefinition } from '../../../../supabase/functions/_shared/learningStructure';

export type DraftPatch = {
  version?: { title?: string; description?: string | null };
  blocks?: { blockId: string; title?: string | null; content?: string; transcript?: string; estimatedMinutes?: number }[];
};
export type GovernedDraftSource = {
  courseId: string; versionId: string; sourceRevision: string; payload: string;
  document: { sourceVersionNumber: number; version: { title: string; description: string | null; aiGenerated: boolean; aiReviewedAt: string | null };
    blocks: { id: string; type: string; title: string | null; body: Record<string, unknown> | null;
      quiz?: { id: string; title: string; kind: 'assessment' | 'knowledge_check' | 'final_exam'; passingScore: number; maxAttempts: number | null;
        shuffleQuestions: boolean; shuffleAnswers: boolean; revealsAnswersAfterAttempt: boolean;
        questions: { id: string; prompt: string; type: 'single_choice' | 'multiple_choice' | 'true_false'; points: number;
          topicCode: string | null; topicLabel: string | null; explanation: string | null;
          options: { id: string; text: string; correct: boolean }[] }[] } | null }[] };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export async function parseGovernedDraftSource(value: unknown): Promise<GovernedDraftSource | null> {
  if (value === null) return null;
  if (!object(value) || typeof value.courseId !== 'string' || !uuid.test(value.courseId) || typeof value.versionId !== 'string' || !uuid.test(value.versionId)
    || typeof value.sourceRevision !== 'string' || !sha.test(value.sourceRevision) || typeof value.payload !== 'string'
    || new TextEncoder().encode(value.payload).byteLength > 2_000_000) throw new Error('Invalid governed draft source.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.payload));
  if (Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') !== value.sourceRevision) throw new Error('Draft source checksum changed.');
  const document: unknown = JSON.parse(value.payload);
  if (!object(document) || document.contract !== 'carebase.course.v1' || typeof document.sourceCourseId !== 'string'
    || document.sourceCourseId.toLowerCase() !== value.courseId.toLowerCase() || typeof document.sourceVersionId !== 'string'
    || document.sourceVersionId.toLowerCase() !== value.versionId.toLowerCase() || document.sourceVersionState !== 'draft'
    || !Number.isSafeInteger(document.sourceVersionNumber) || !object(document.version) || typeof document.version.title !== 'string'
    || typeof document.version.aiGenerated !== 'boolean' || !Array.isArray(document.blocks)
    || document.blocks.some(block => !object(block) || typeof block.id !== 'string' || !uuid.test(block.id) || typeof block.type !== 'string')) {
    throw new Error('Draft source identity changed.');
  }
  return { courseId: value.courseId, versionId: value.versionId, sourceRevision: value.sourceRevision, payload: value.payload,
    document: document as GovernedDraftSource['document'] };
}
export async function loadGovernedDraftSource(versionId: string) {
  const { data, error } = await supabase.rpc('get_native_learning_draft_source', { p_version_id: versionId });
  if (error) throw error;
  return parseGovernedDraftSource(data);
}
export type NativeDraftIntent = { key: string; requestId: string };
export function nativeDraftIntent(previous: NativeDraftIntent | null, value: unknown, createId = () => crypto.randomUUID()): NativeDraftIntent {
  const key = JSON.stringify(value);
  return previous?.key === key ? previous : { key, requestId: createId() };
}
export async function executeNativeDraft(source: GovernedDraftSource, action: 'learning.patchDraft' | 'learning.reviewDraft' | 'learning.editStructure',
  requestId: string, reason: string, patch?: DraftPatch | StructureChange[]) {
  if (action === 'learning.editStructure' && !validStructureChanges(patch)) throw new Error('Review the structure fields and answer key before saving.');
  const parameters = { versionId: source.versionId, sourceRevision: source.sourceRevision,
    ...(action === 'learning.patchDraft' ? { patch } : action === 'learning.editStructure' ? { changes: patch } : { reviewed: true }) };
  const { data, error } = await supabase.rpc('execute_native_learning_draft_command', { p_request_id: requestId, p_action: action,
    p_course_id: source.courseId, p_parameters: parameters as Json, p_reason: reason });
  if (error) throw error;
  if (!object(data) || data.action !== action || data.courseId !== source.courseId || data.versionId !== source.versionId || data.status !== 'draft'
    || data.versionNumber !== source.document.sourceVersionNumber || typeof data.sourceRevision !== 'string' || !sha.test(data.sourceRevision)) {
    throw new Error('Draft response did not match this reviewed change. Retry the same request.');
  }
  return data;
}
