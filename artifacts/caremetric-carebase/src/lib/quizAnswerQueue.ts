export interface QuizAnswerWrite {
  attempt_id: string;
  question_id: string;
  selected_answer_ids: string[];
}

/** Keep autosaves in selection order and persist a complete snapshot before grading. */
export function createQuizAnswerQueue(write: (answer: QuizAnswerWrite) => Promise<unknown>) {
  let pending: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    // One failed autosave must not prevent the learner from retrying it at submission.
    pending = result.catch(() => undefined);
    return result;
  }

  return {
    save(answer: QuizAnswerWrite) {
      const snapshot = { ...answer, selected_answer_ids: [...answer.selected_answer_ids] };
      return enqueue(() => write(snapshot));
    },
    submit(
      attemptId: string,
      questionIds: string[],
      selections: Record<string, string[]>,
      grade: (attemptId: string) => Promise<unknown>,
    ) {
      const answers = questionIds.map(questionId => ({
        attempt_id: attemptId,
        question_id: questionId,
        selected_answer_ids: [...(selections[questionId] ?? [])],
      }));
      return enqueue(async () => {
        if (!answers.length || answers.some(answer => !answer.selected_answer_ids.length)) {
          throw new Error("Answer every question before submitting.");
        }
        // Re-save even previously failed autosaves. A failed final write stops grading, so
        // the server never grades answers that differ from the learner's submission.
        for (const answer of answers) await write(answer);
        return grade(attemptId);
      });
    },
  };
}
