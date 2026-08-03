import { describe, expect, it } from "vitest";
import {
  draftQuestionProblems,
  draftQuestionsAreValid,
  emptyDraftQuestion,
  MAX_CHOICES,
  MIN_CHOICES,
  normalizeDraftQuestion,
  type DraftQuestion,
} from "./CampaignQuestionsEditor";

// These mirror policy_campaign_questions' CHECK constraints (see
// 20260802070000_policy_campaign_knowledge_checks.sql). The database is the authority; this suite
// exists so the two do not drift, because the client-side copy is what an author actually sees.

function question(overrides: Partial<DraftQuestion> = {}): DraftQuestion {
  return { prompt: "When must hands be washed?", choices: ["Always", "Never"], correctIndex: 0, ...overrides };
}

describe("draftQuestionProblems", () => {
  it("accepts a well-formed question", () => {
    expect(draftQuestionProblems(question())).toEqual([]);
  });

  it("requires question text", () => {
    expect(draftQuestionProblems(question({ prompt: "   " }))).toContain("Question text is required.");
  });

  it(`requires at least ${MIN_CHOICES} non-empty choices`, () => {
    expect(draftQuestionProblems(question({ choices: ["Only one", "   "] }))).toContain(
      `At least ${MIN_CHOICES} answer choices are required.`,
    );
  });

  it("counts only non-empty choices toward the minimum", () => {
    // A blank third box while the author is still typing must not be treated as a real choice.
    expect(draftQuestionProblems(question({ choices: ["Always", "Never", ""] }))).toEqual([]);
  });

  it(`rejects more than ${MAX_CHOICES} choices`, () => {
    const tooMany = Array.from({ length: MAX_CHOICES + 1 }, (_, i) => `Choice ${i}`);
    expect(draftQuestionProblems(question({ choices: tooMany }))).toContain(
      `No more than ${MAX_CHOICES} choices.`,
    );
  });

  it("requires the marked-correct choice to actually have text", () => {
    // The specific trap this catches: author adds a third choice, marks it correct, then clears it.
    expect(draftQuestionProblems(question({ choices: ["Always", "Never", ""], correctIndex: 2 }))).toContain(
      "Mark which choice is correct.",
    );
  });

  it("treats an out-of-range correct index as unmarked rather than crashing", () => {
    expect(draftQuestionProblems(question({ correctIndex: 99 }))).toContain("Mark which choice is correct.");
  });
});

describe("draftQuestionsAreValid", () => {
  it("is true for an empty list -- a campaign with no knowledge check is valid", () => {
    expect(draftQuestionsAreValid([])).toBe(true);
  });

  it("is false when any question is incomplete", () => {
    expect(draftQuestionsAreValid([question(), emptyDraftQuestion()])).toBe(false);
  });

  it("is true when every question is complete", () => {
    expect(draftQuestionsAreValid([question(), question({ prompt: "Who reports an outbreak?" })])).toBe(true);
  });
});

describe("emptyDraftQuestion", () => {
  it(`starts with exactly ${MIN_CHOICES} blank choices`, () => {
    const fresh = emptyDraftQuestion();
    expect(fresh.choices).toHaveLength(MIN_CHOICES);
    expect(fresh.prompt).toBe("");
    expect(fresh.correctIndex).toBe(0);
  });

  it("is not valid until filled in", () => {
    expect(draftQuestionProblems(emptyDraftQuestion()).length).toBeGreaterThan(0);
  });
});

describe("normalizeDraftQuestion", () => {
  it("leaves a clean question untouched", () => {
    expect(normalizeDraftQuestion(question({ choices: ["Always", "Never"], correctIndex: 1 })))
      .toEqual({ choices: ["Always", "Never"], correctIndex: 1 });
  });

  it("trims surrounding whitespace off every choice", () => {
    expect(normalizeDraftQuestion(question({ choices: ["  Always ", "Never  "], correctIndex: 0 })))
      .toEqual({ choices: ["Always", "Never"], correctIndex: 0 });
  });

  // The regression this function exists for. Dropping the leading blank without remapping would
  // move correctIndex 1 from "Always" onto "Never" -- storing the wrong answer key, so every
  // employee who answered correctly would be marked wrong.
  it("re-points the correct index when a blank choice precedes it", () => {
    expect(normalizeDraftQuestion(question({ choices: ["", "Always", "Never"], correctIndex: 1 })))
      .toEqual({ choices: ["Always", "Never"], correctIndex: 0 });
  });

  it("re-points across several preceding blanks", () => {
    expect(normalizeDraftQuestion(question({ choices: ["", "  ", "Always", "Never"], correctIndex: 3 })))
      .toEqual({ choices: ["Always", "Never"], correctIndex: 1 });
  });

  it("leaves the index alone when the blanks come after it", () => {
    expect(normalizeDraftQuestion(question({ choices: ["Always", "Never", ""], correctIndex: 0 })))
      .toEqual({ choices: ["Always", "Never"], correctIndex: 0 });
  });

  it("clamps an out-of-range index instead of emitting one the DB constraint would reject", () => {
    expect(normalizeDraftQuestion(question({ choices: ["Always", "Never"], correctIndex: 99 })))
      .toEqual({ choices: ["Always", "Never"], correctIndex: 0 });
  });
});
