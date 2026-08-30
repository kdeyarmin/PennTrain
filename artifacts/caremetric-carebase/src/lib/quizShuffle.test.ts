import { describe, expect, it } from "vitest";
import { orderAnswersForAttempt, orderQuestionsForAttempt, seededShuffle } from "./quizShuffle";

const QUESTIONS = Array.from({ length: 30 }, (_, index) => ({ id: `q${index + 1}` }));

describe("seededShuffle", () => {
  it("keeps every item exactly once", () => {
    const shuffled = seededShuffle(QUESTIONS, "attempt-1");
    expect(shuffled).toHaveLength(QUESTIONS.length);
    expect(new Set(shuffled.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });

  it("does not mutate its input", () => {
    const original = QUESTIONS.map((q) => q.id);
    seededShuffle(QUESTIONS, "attempt-1");
    expect(QUESTIONS.map((q) => q.id)).toEqual(original);
  });

  it("is stable for one seed and different across seeds", () => {
    // Stability is the whole point: every saved answer re-renders the exam page, and a shuffle
    // that recomputed would reorder the paper underneath the person taking it.
    expect(seededShuffle(QUESTIONS, "attempt-1")).toEqual(seededShuffle(QUESTIONS, "attempt-1"));
    expect(seededShuffle(QUESTIONS, "attempt-1")).not.toEqual(seededShuffle(QUESTIONS, "attempt-2"));
  });

  it("actually reorders a thirty-item exam", () => {
    const shuffled = seededShuffle(QUESTIONS, "attempt-1").map((q) => q.id);
    expect(shuffled).not.toEqual(QUESTIONS.map((q) => q.id));
  });
});

describe("orderQuestionsForAttempt", () => {
  it("returns the authored order when the quiz does not opt into randomization", () => {
    expect(orderQuestionsForAttempt(QUESTIONS, "attempt-1", false).map((q) => q.id))
      .toEqual(QUESTIONS.map((q) => q.id));
  });

  it("returns the authored order before an attempt exists", () => {
    expect(orderQuestionsForAttempt(QUESTIONS, null, true).map((q) => q.id))
      .toEqual(QUESTIONS.map((q) => q.id));
  });

  it("randomizes once per attempt", () => {
    const first = orderQuestionsForAttempt(QUESTIONS, "attempt-1", true).map((q) => q.id);
    const again = orderQuestionsForAttempt(QUESTIONS, "attempt-1", true).map((q) => q.id);
    const second = orderQuestionsForAttempt(QUESTIONS, "attempt-2", true).map((q) => q.id);
    expect(first).toEqual(again);
    expect(first).not.toEqual(second);
  });
});

describe("orderAnswersForAttempt", () => {
  const answers = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("returns the authored order when randomization is off", () => {
    expect(orderAnswersForAttempt(answers, "attempt-1", "q1", false)).toEqual(answers);
  });

  it("gives two questions in the same attempt different permutations", () => {
    // Seeded only on the attempt, every question in an attempt would receive the identical
    // permutation, which is a pattern a learner can memorize across retakes.
    const permutations = new Set(
      ["q1", "q2", "q3", "q4", "q5", "q6"].map((questionId) =>
        orderAnswersForAttempt(answers, "attempt-1", questionId, true).map((a) => a.id).join(""),
      ),
    );
    expect(permutations.size).toBeGreaterThan(1);
  });

  it("is stable for one question within one attempt", () => {
    expect(orderAnswersForAttempt(answers, "attempt-1", "q1", true))
      .toEqual(orderAnswersForAttempt(answers, "attempt-1", "q1", true));
  });
});
