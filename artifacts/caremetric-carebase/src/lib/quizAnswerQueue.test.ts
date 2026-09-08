import { describe, expect, it, vi } from "vitest";
import { createQuizAnswerQueue, type QuizAnswerWrite } from "./quizAnswerQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("quiz answer persistence", () => {
  it("serializes changed answers and waits for the submitted snapshot before grading", async () => {
    const first = deferred();
    const events: string[] = [];
    const write = vi.fn(async (answer: QuizAnswerWrite) => {
      const value = answer.selected_answer_ids.join(",");
      events.push(`start:${value}`);
      if (value === "old") await first.promise;
      events.push(`saved:${value}`);
    });
    const queue = createQuizAnswerQueue(write);
    const oldSave = queue.save({ attempt_id: "attempt", question_id: "q1", selected_answer_ids: ["old"] });
    const newSave = queue.save({ attempt_id: "attempt", question_id: "q1", selected_answer_ids: ["new"] });
    const submission = queue.submit("attempt", ["q1", "q2"], { q1: ["new"], q2: ["last"] }, async () => {
      events.push("graded");
    });
    await Promise.resolve();
    expect(events).toEqual(["start:old"]);
    first.resolve();
    await Promise.all([oldSave, newSave, submission]);
    expect(events).toEqual([
      "start:old", "saved:old", "start:new", "saved:new", "start:new", "saved:new",
      "start:last", "saved:last", "graded",
    ]);
  });

  it("retries failed autosaves from the current submission", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValue(undefined);
    const grade = vi.fn().mockResolvedValue(undefined);
    const queue = createQuizAnswerQueue(write);
    await expect(queue.save({ attempt_id: "attempt", question_id: "q1", selected_answer_ids: ["answer"] }))
      .rejects.toThrow("Network unavailable");
    await queue.submit("attempt", ["q1"], { q1: ["answer"] }, grade);
    expect(write).toHaveBeenCalledTimes(2);
    expect(grade).toHaveBeenCalledWith("attempt");
  });

  it("does not grade when the final answer save fails, and allows a retry", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("Save failed")).mockResolvedValue(undefined);
    const grade = vi.fn().mockResolvedValue(undefined);
    const queue = createQuizAnswerQueue(write);
    await expect(queue.submit("attempt", ["q1"], { q1: ["answer"] }, grade)).rejects.toThrow("Save failed");
    expect(grade).not.toHaveBeenCalled();
    await queue.submit("attempt", ["q1"], { q1: ["answer"] }, grade);
    expect(grade).toHaveBeenCalledOnce();
  });

  it("freezes selections at submission and never includes answers from another quiz", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const grade = vi.fn().mockResolvedValue(undefined);
    const queue = createQuizAnswerQueue(write);
    const selections = { q1: ["answer"], otherQuiz: ["unrelated"] };
    const submission = queue.submit("attempt", ["q1"], selections, grade);
    selections.q1.push("later-change");
    await submission;
    expect(write).toHaveBeenCalledExactlyOnceWith({
      attempt_id: "attempt", question_id: "q1", selected_answer_ids: ["answer"],
    });
  });

  it.each([{ questionIds: [] }, { questionIds: ["q1", "q2"] }])("refuses an empty or incomplete submission ($questionIds)", async ({ questionIds }) => {
    const write = vi.fn().mockResolvedValue(undefined);
    const grade = vi.fn().mockResolvedValue(undefined);
    await expect(createQuizAnswerQueue(write).submit("attempt", questionIds, { q1: ["answer"] }, grade))
      .rejects.toThrow("Answer every question");
    expect(write).not.toHaveBeenCalled();
    expect(grade).not.toHaveBeenCalled();
  });
});
