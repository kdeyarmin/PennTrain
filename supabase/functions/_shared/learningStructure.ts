// Definition-only authoring contract. This module never reads learner records or media bytes.
export const LESSON_TYPES = ['text', 'video', 'pdf', 'scorm', 'quiz', 'attestation'] as const;
export const ACTIVITY_TYPES = ['objectives', 'instruction', 'guided_instruction', 'scenario', 'practice', 'facility_verification', 'sources', 'assessment', 'attestation'] as const;
export type LessonType = typeof LESSON_TYPES[number];
export type LessonFields = { title?: string | null; estimatedMinutes?: number; activityType?: typeof ACTIVITY_TYPES[number];
  content?: string; transcript?: string; attestationText?: string; attestationVersion?: string };
export type QuizPolicy = { blockId: string; quizId: string; title: string; kind: 'assessment' | 'knowledge_check' | 'final_exam';
  passingScore: number; maxAttempts: number | null; shuffleQuestions: boolean; shuffleAnswers: boolean; revealsAnswersAfterAttempt: boolean };
export type QuestionDefinition = { quizId: string; questionId: string; prompt: string; type: 'single_choice' | 'multiple_choice' | 'true_false';
  points: number; topicCode: string | null; topicLabel: string | null; explanation: string | null;
  answers: { answerId: string; text: string; correct: boolean }[]; removedAnswerIds: string[] };
export type StructureChange =
  | { operation: 'addLesson'; blockId: string; blockType: LessonType; title: string | null; body: Omit<LessonFields, 'title'> }
  | { operation: 'editLesson'; blockId: string; patch: LessonFields }
  | { operation: 'removeLesson'; blockId: string; removedQuestionIds: string[] }
  | { operation: 'reorderLessons'; blockIds: string[] }
  | ({ operation: 'configureQuiz' } & QuizPolicy)
  | ({ operation: 'saveQuestion' } & QuestionDefinition)
  | { operation: 'removeQuestion'; quizId: string; questionId: string }
  | { operation: 'reorderQuestions'; quizId: string; questionIds: string[] };

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EXCLUDED = /([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_?token|refresh_?token|service_?role_?key|authorization|password|client_?secret|storage_?(path|bucket)|video_?url|playback_?(url|token)|signed_?url|api_?key|token|secret|secret_?key|signing_?secret)"\s*:)/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const text = (value: unknown, min: number, max: number): value is string => typeof value === 'string' && value === value.trim() && value.length >= min && value.length <= max && !/\p{Cc}/u.test(value);
const prose = (value: unknown, nonblank = false): value is string => typeof value === 'string' && value.length <= 12000
  && (!nonblank || value.trim().length > 0) && !/\p{Cc}/u.test(value.replace(/[\r\n\t]/g, ''));
const ids = (value: unknown, min: number, max: number): value is string[] => Array.isArray(value) && value.length >= min && value.length <= max
  && value.every(id) && new Set(value.map(item => item.toLowerCase())).size === value.length;
const lessonKeys = ['title', 'estimatedMinutes', 'activityType', 'content', 'transcript', 'attestationText', 'attestationVersion'];
function lessonFields(value: unknown, type?: string, body = false): boolean {
  if (!object(value) || Object.keys(value).some(key => !lessonKeys.includes(key) || body && key === 'title')) return false;
  if (!body && Object.keys(value).length === 0) return false;
  if (Object.hasOwn(value, 'title') && value.title !== null && !text(value.title, 0, 300)) return false;
  if (Object.hasOwn(value, 'estimatedMinutes') && !integer(value.estimatedMinutes, 0, 1440)) return false;
  if (Object.hasOwn(value, 'activityType') && !(ACTIVITY_TYPES as readonly unknown[]).includes(value.activityType)) return false;
  for (const key of ['content', 'transcript', 'attestationText']) if (Object.hasOwn(value, key) && !prose(value[key])) return false;
  if (Object.hasOwn(value, 'attestationVersion') && !text(value.attestationVersion, 1, 128)) return false;
  if (type && (Object.hasOwn(value, 'content') && type !== 'text' || Object.hasOwn(value, 'transcript') && type !== 'video'
    || (Object.hasOwn(value, 'attestationText') || Object.hasOwn(value, 'attestationVersion')) && type !== 'attestation')) return false;
  return true;
}
export function validStructureChanges(value: unknown): value is StructureChange[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return false;
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > 24576 || EXCLUDED.test(serialized)) return false;
  return value.every(change => {
    if (!object(change)) return false;
    switch (change.operation) {
      case 'addLesson': return exact(change, ['operation', 'blockId', 'blockType', 'title', 'body']) && id(change.blockId)
        && (LESSON_TYPES as readonly unknown[]).includes(change.blockType) && (change.title === null || text(change.title, 0, 300))
        && lessonFields(change.body, change.blockType as string, true);
      case 'editLesson': return exact(change, ['operation', 'blockId', 'patch']) && id(change.blockId) && lessonFields(change.patch);
      case 'removeLesson': return exact(change, ['operation', 'blockId', 'removedQuestionIds']) && id(change.blockId) && ids(change.removedQuestionIds, 0, 500);
      case 'reorderLessons': return exact(change, ['operation', 'blockIds']) && ids(change.blockIds, 1, 500);
      case 'configureQuiz': return exact(change, ['operation', 'blockId', 'quizId', 'title', 'kind', 'passingScore', 'maxAttempts', 'shuffleQuestions', 'shuffleAnswers', 'revealsAnswersAfterAttempt'])
        && id(change.blockId) && id(change.quizId) && text(change.title, 1, 300) && ['assessment', 'knowledge_check', 'final_exam'].includes(change.kind as string)
        && integer(change.passingScore, 0, 100) && (change.maxAttempts === null || integer(change.maxAttempts, 1, 2147483647))
        && ['shuffleQuestions', 'shuffleAnswers', 'revealsAnswersAfterAttempt'].every(key => typeof change[key] === 'boolean')
        && (!change.revealsAnswersAfterAttempt || change.kind === 'knowledge_check');
      case 'saveQuestion': {
        if (!exact(change, ['operation', 'quizId', 'questionId', 'prompt', 'type', 'points', 'topicCode', 'topicLabel', 'explanation', 'answers', 'removedAnswerIds'])
          || !id(change.quizId) || !id(change.questionId) || !prose(change.prompt, true) || !['single_choice', 'multiple_choice', 'true_false'].includes(change.type as string)
          || !integer(change.points, 1, 2147483647) || !(change.topicCode === null || text(change.topicCode, 1, 128))
          || !(change.topicLabel === null || text(change.topicLabel, 1, 300)) || !(change.explanation === null || prose(change.explanation))
          || !Array.isArray(change.answers) || change.answers.length < 2 || change.answers.length > 100 || !ids(change.removedAnswerIds, 0, 100)) return false;
        if (!change.answers.every(answer => exact(answer, ['answerId', 'text', 'correct']) && id(answer.answerId) && prose(answer.text, true) && typeof answer.correct === 'boolean')) return false;
        if (!ids(change.answers.map(answer => answer.answerId), 2, 100)) return false;
        if (change.answers.some(answer => (change.removedAnswerIds as string[]).some(removed => removed.toLowerCase() === answer.answerId.toLowerCase()))) return false;
        const correct = change.answers.filter(answer => answer.correct).length;
        return change.type === 'multiple_choice' ? correct >= 1 : correct === 1;
      }
      case 'removeQuestion': return exact(change, ['operation', 'quizId', 'questionId']) && id(change.quizId) && id(change.questionId);
      case 'reorderQuestions': return exact(change, ['operation', 'quizId', 'questionIds']) && id(change.quizId) && ids(change.questionIds, 1, 500);
      default: return false;
    }
  });
}
