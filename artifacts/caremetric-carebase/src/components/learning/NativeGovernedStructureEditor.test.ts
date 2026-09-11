import { describe, expect, it, vi } from 'vitest';
vi.mock('@/hooks/useQuizzes', () => ({ useEditGovernedLearningStructure: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
import { questionChange, removeAnswer } from './NativeGovernedStructureEditor';
import type { GovernedDraftSource } from '@/lib/governedLearningDraft';
const id = (n: number) => `abb00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const block: GovernedDraftSource['document']['blocks'][number] = { id: id(1), type: 'quiz', title: 'Quiz lesson', body: null,
  quiz: { id: id(2), title: 'Quiz', kind: 'knowledge_check', passingScore: 80, maxAttempts: null, shuffleQuestions: true, shuffleAnswers: true,
    revealsAnswersAfterAttempt: true, questions: [{ id: id(3), prompt: 'Question', type: 'single_choice', points: 101, topicCode: 'CODE', topicLabel: 'Label',
      explanation: 'Private author explanation', options: [{ id: id(4), text: 'Correct', correct: true }, { id: id(5), text: 'Distractor', correct: false }] }] } };
describe('native complete question form identity', () => {
  it('preserves the exact question, answer IDs, weighted points and restricted explanation', () => {
    const question = block.quiz!.questions[0]; const form = questionChange(block, question);
    expect(form).toMatchObject({ questionId: question.id, points: 101, explanation: question.explanation, removedAnswerIds: [] });
    expect(form.answers).toEqual(question.options.map(option => ({ answerId: option.id, text: option.text, correct: option.correct })));
    form.answers[0].text = 'Unsaved edit'; expect(question.options[0].text).toBe('Correct');
  });
  it('requires a human answer-key choice for a new question and uses distinct retained IDs', () => {
    const form = questionChange(block);
    expect(form.answers).toHaveLength(2); expect(form.answers.every(answer => !answer.correct)).toBe(true);
    expect(new Set([form.questionId, ...form.answers.map(answer => answer.answerId)]).size).toBe(3);
  });
  it('explicitly removes only persisted answers, retaining original IDs through local edits', () => {
    const original = block.quiz!.questions[0]; const form = questionChange(block, original);
    form.answers.push({ answerId: id(6), text: 'Unsaved distractor', correct: false });
    const removedNew = removeAnswer(form, id(6), original); expect(removedNew.removedAnswerIds).toEqual([]);
    const removedExisting = removeAnswer(removedNew, id(5), original); expect(removedExisting.removedAnswerIds).toEqual([id(5)]);
    expect(removedExisting.answers[0].answerId).toBe(id(4)); expect(original.options).toHaveLength(2);
  });
});
