import assert from 'node:assert/strict';
import test from 'node:test';
import { validStructureChanges } from '../../../supabase/functions/_shared/learningStructure.ts';
import { parseAuthoringOperation, projectAuthoringResult } from './platform-admin-authoring.mjs';
const id = n => `aba00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const question = () => ({ operation: 'saveQuestion', quizId: id(1), questionId: id(2), prompt: 'Question', type: 'single_choice', points: 101,
  topicCode: null, topicLabel: null, explanation: 'Author explanation', answers: [{ answerId: id(3), text: 'Correct', correct: true },
    { answerId: id(4), text: 'Distractor', correct: false }], removedAnswerIds: [] });
const quiz = { operation: 'configureQuiz', blockId: id(5), quizId: id(1), title: 'Quiz', kind: 'knowledge_check', passingScore: 80,
  maxAttempts: null, shuffleQuestions: true, shuffleAnswers: true, revealsAnswersAfterAttempt: true };
test('closed structure contract accepts all six lesson types and eight operations', () => {
  for (const blockType of ['text', 'video', 'pdf', 'scorm', 'quiz', 'attestation']) assert.equal(validStructureChanges([
    { operation: 'addLesson', blockId: id(5), blockType, title: null, body: {} }]), true);
  for (const change of [quiz, question(), { operation: 'editLesson', blockId: id(5), patch: { activityType: 'attestation', estimatedMinutes: 2 } },
    { operation: 'removeLesson', blockId: id(5), removedQuestionIds: [id(2)] }, { operation: 'reorderLessons', blockIds: [id(5)] },
    { operation: 'removeQuestion', quizId: id(1), questionId: id(2) }, { operation: 'reorderQuestions', quizId: id(1), questionIds: [id(2)] }]) {
    assert.equal(validStructureChanges([change]), true, change.operation);
  }
});
test('question choices require a complete atomic key and explicit disjoint removals', () => {
  const original = question();
  assert.equal(validStructureChanges([original]), true);
  for (const change of [{ ...original, answers: original.answers.map(answer => ({ ...answer, correct: false })) },
    { ...original, answers: original.answers.map(answer => ({ ...answer, correct: true })) },
    { ...original, answers: [original.answers[0]] }, { ...original, answers: [original.answers[0], { ...original.answers[0], answerId: id(3).toUpperCase() }] },
    { ...original, removedAnswerIds: [id(3)] }, { ...original, answers: original.answers.map(answer => ({ ...answer, privateUri: 'secret' })) }]) assert.equal(validStructureChanges([change]), false);
  assert.equal(validStructureChanges([{ ...original, type: 'multiple_choice', answers: original.answers.map(answer => ({ ...answer, correct: true })) }]), true);
});
test('native full positive integer policy is preserved and invalid numbers fail', () => {
  assert.equal(validStructureChanges([{ ...question(), points: 2147483647 }]), true);
  assert.equal(validStructureChanges([{ ...quiz, maxAttempts: 2147483647 }]), true);
  for (const points of [0, -1, 1.5, 2147483648, Infinity, NaN]) assert.equal(validStructureChanges([{ ...question(), points }]), false);
  for (const passingScore of [-1, 0.5, 101]) assert.equal(validStructureChanges([{ ...quiz, passingScore }]), false);
  assert.equal(validStructureChanges([{ ...quiz, kind: 'final_exam' }]), false);
});
test('new lesson fields are typed and refuse media, approval and private locator input', () => {
  const base = { operation: 'addLesson', blockId: id(5), blockType: 'text', title: null, body: { content: 'Lesson\nWith\tformatting' } };
  assert.equal(validStructureChanges([base]), true);
  for (const body of [{ transcript: 'Wrong kind' }, { estimatedMinutes: '2' }, { activityType: 'unknown' }, { videoUrl: 'private' }, { documentId: id(8) },
    { content: 'https://private.test?token=synthetic' }, { content: 'Control\u0001' }, { content: '\u0085' }, { aiReviewedAt: 'now' }]) assert.equal(validStructureChanges([{ ...base, body }]), false);
  assert.equal(validStructureChanges([{ ...base, title: ' untrimmed ' }]), false);
});
test('structure payload uses exact 24KiB wire bytes including actual prose spaces', () => {
  const first = { operation: 'addLesson', blockId: id(5), blockType: 'text', title: '', body: { content: ' '.repeat(12000) } };
  const second = { ...first, blockId: id(6), body: { content: 'x'.repeat(12000) } };
  const changes = [first, second]; const remaining = 24576 - Buffer.byteLength(JSON.stringify(changes));
  first.title = 'x'.repeat(Math.floor(remaining / 2)); second.title = 'x'.repeat(remaining - first.title.length);
  assert.equal(Buffer.byteLength(JSON.stringify(changes)), 24576); assert.equal(validStructureChanges(changes), true);
  first.title += 'x'; assert.equal(validStructureChanges(changes), false);
});
test('structure parser and result projection retain action/version/hash without answer data', () => {
  const preview = { operation: 'preview', requestId: id(9), action: 'learning.editStructure', courseId: id(10), reason: 'Reviewed exact complete answer set',
    parameters: { versionId: id(11), sourceRevision: 'a'.repeat(64), changes: [question()] } };
  assert.deepEqual(parseAuthoringOperation(preview), preview);
  assert.throws(() => parseAuthoringOperation({ ...preview, parameters: { ...preview.parameters, actor: id(12) } }));
  const result = { commandId: id(13), action: preview.action, courseId: id(10), versionId: id(11), versionNumber: 2, status: 'draft',
    sourceRevision: 'b'.repeat(64), appliedAt: '2026-09-11T20:00:00Z', replayed: false, answerKey: question() };
  const op = { operation: 'apply', commandId: id(13), expectedDigest: 'c'.repeat(64) };
  assert.equal(projectAuthoringResult(result, op).answerKey, undefined);
  assert.throws(() => projectAuthoringResult({ ...result, sourceRevision: undefined }, op));
  assert.throws(() => projectAuthoringResult({ ...result, status: 'published' }, op));
});
