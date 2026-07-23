import { describe, expect, it } from "vitest";
import {
  buildStudyGuide,
  canAdvanceCourseStep,
  canMutateCourseEvidence,
  estimateBlockMinutes,
  getBlockLabel,
  getLearningStepLabel,
  getTextPreview,
  hasLearningToolsEntries,
  isAppliedResponseComplete,
  lessonStorageKey,
  MIN_APPLIED_RESPONSE_CHARACTERS,
  parseLearningToolsState,
  requiresAppliedResponse,
  sanitizeLearningToolsState,
  shouldEnableCourseShortcuts,
  type LearningToolBlock,
} from "./courseLearningTools";

const block = (overrides: Partial<LearningToolBlock>): LearningToolBlock => ({
  id: "block-1",
  title: "Lesson title",
  block_type: "text",
  body: { content: "Short lesson text." },
  ...overrides,
});

describe("course learning tools", () => {
  it("labels known course block types for employees", () => {
    expect(getBlockLabel("text")).toBe("Reading");
    expect(getBlockLabel("video")).toBe("Video");
    expect(getBlockLabel("pdf")).toBe("Document");
    expect(getBlockLabel("scorm")).toBe("Interactive");
    expect(getBlockLabel("quiz")).toBe("Knowledge check");
    expect(getBlockLabel("unknown")).toBe("Lesson");
  });

  it("estimates reading time from text and defaults other content types", () => {
    expect(estimateBlockMinutes(block({ body: { content: "word ".repeat(181) } }))).toBe(2);
    expect(estimateBlockMinutes(block({ block_type: "video" }))).toBe(5);
    expect(estimateBlockMinutes(block({ block_type: "pdf" }))).toBe(4);
    expect(estimateBlockMinutes(block({ block_type: "quiz" }))).toBe(3);
  });

  it("labels comprehensive activities by their learning purpose", () => {
    expect(getLearningStepLabel(block({ body: { activity_type: "objectives" } }))).toBe("Learning objectives");
    expect(getLearningStepLabel(block({ body: { activity_type: "guided_instruction" } }))).toBe("Guided lesson");
    expect(getLearningStepLabel(block({ body: { activity_type: "scenario" } }))).toBe("Applied scenario");
    expect(getLearningStepLabel(block({ body: { activity_type: "practice" } }))).toBe("Guided practice");
    expect(getLearningStepLabel(block({ body: { activity_type: "sources" } }))).toBe("Sources and scope");
    expect(getLearningStepLabel(block({ block_type: "quiz", body: { activity_type: "assessment" } }))).toBe("Final assessment");
    expect(getLearningStepLabel(block({ block_type: "video", body: null }))).toBe("Video");
  });

  it("requires a substantive learner response for applied activities", () => {
    const scenario = block({ body: { activity_type: "scenario" } });
    const practice = block({ body: { activity_type: "practice" } });
    const lesson = block({ body: { activity_type: "instruction" } });

    expect(requiresAppliedResponse(scenario)).toBe(true);
    expect(requiresAppliedResponse(practice)).toBe(true);
    expect(requiresAppliedResponse(lesson)).toBe(false);
    expect(isAppliedResponseComplete(scenario, "too short")).toBe(false);
    expect(isAppliedResponseComplete(scenario, "x".repeat(MIN_APPLIED_RESPONSE_CHARACTERS))).toBe(true);
    expect(isAppliedResponseComplete(lesson, "")).toBe(true);
  });

  it("allows documentation writes only for the assignment's learner before completion", () => {
    expect(canMutateCourseEvidence("employee-1", "employee-1", "in_progress")).toBe(true);
    expect(canMutateCourseEvidence("employee-1", "employee-2", "in_progress")).toBe(false);
    expect(canMutateCourseEvidence("employee-1", undefined, "in_progress")).toBe(false);
    expect(canMutateCourseEvidence("employee-1", "employee-1", "completed")).toBe(false);
  });

  it("keeps active-course gates while letting completed review move through every step", () => {
    const blocked = {
      completionEvidenceLocked: false,
      isQuizBlock: true,
      currentQuizPassed: false,
      videoGateBlocksAdvance: true,
      appliedResponseRequired: true,
      appliedResponseComplete: false,
    };
    expect(canAdvanceCourseStep(blocked)).toBe(false);
    expect(canAdvanceCourseStep({ ...blocked, completionEvidenceLocked: true })).toBe(true);
    expect(canAdvanceCourseStep({
      ...blocked,
      isQuizBlock: false,
      videoGateBlocksAdvance: false,
      appliedResponseRequired: false,
    })).toBe(true);
  });

  it("disables lesson shortcuts while a modal course dialog is open", () => {
    const active = {
      ownsAssignment: true,
      hasBlocks: true,
      showRatingPrompt: false,
      showClearLearningToolsConfirm: false,
    };
    expect(shouldEnableCourseShortcuts(active)).toBe(true);
    expect(shouldEnableCourseShortcuts({ ...active, showRatingPrompt: true })).toBe(false);
    expect(shouldEnableCourseShortcuts({ ...active, showClearLearningToolsConfirm: true })).toBe(false);
    expect(shouldEnableCourseShortcuts({ ...active, ownsAssignment: false })).toBe(false);
    expect(shouldEnableCourseShortcuts({ ...active, hasBlocks: false })).toBe(false);
  });

  it("uses an explicit designed duration when comprehensive content provides one", () => {
    expect(estimateBlockMinutes(block({ body: { content: "Short activity.", estimated_minutes: 25 } }))).toBe(25);
    expect(estimateBlockMinutes(block({ block_type: "quiz", body: { estimated_minutes: 10 } }))).toBe(10);
    expect(estimateBlockMinutes(block({ body: { estimated_minutes: 0, content: "word ".repeat(181) } }))).toBe(2);
    expect(estimateBlockMinutes(block({ body: { estimated_minutes: 12.5, content: "Short text." } }))).toBe(1);
    expect(estimateBlockMinutes(block({ body: { estimated_minutes: 121, content: "Short text." } }))).toBe(1);
  });

  it("extracts a concise first-line preview", () => {
    expect(getTextPreview(block({ body: { content: "\n\nFirst line\nSecond line" } }))).toBe("First line");
    expect(getTextPreview(block({ body: { content: "x".repeat(160) } }))?.endsWith("...")).toBe(true);
    expect(getTextPreview(block({ body: { content: "   " } }))).toBeNull();
  });

  it("scopes local learning-tool storage by assignment", () => {
    expect(lessonStorageKey("assignment-1")).toBe("caremetric:course-learning-tools:assignment-1");
    expect(lessonStorageKey(undefined)).toBeNull();
  });

  it("sanitizes local learning-tool storage before restoring it", () => {
    expect(parseLearningToolsState(null)).toEqual({ notes: {}, confidence: {} });
    expect(parseLearningToolsState("{not json")).toEqual({ notes: {}, confidence: {} });
    expect(parseLearningToolsState(JSON.stringify({
      notes: { one: "Keep this", two: 123, three: null },
      confidence: { one: "ready", two: "invalid", three: "review" },
    }))).toEqual({
      notes: { one: "Keep this" },
      confidence: { one: "ready", three: "review" },
    });
  });

  it("sanitizes server-stored learning-tools objects with the same rules", () => {
    expect(sanitizeLearningToolsState(null)).toEqual({ notes: {}, confidence: {} });
    expect(sanitizeLearningToolsState("nonsense")).toEqual({ notes: {}, confidence: {} });
    expect(sanitizeLearningToolsState([1, 2])).toEqual({ notes: {}, confidence: {} });
    const raw = {
      notes: { one: "Keep this", two: 123 },
      confidence: { one: "ready", two: "invalid" },
      extra: "ignored",
    };
    expect(sanitizeLearningToolsState(raw)).toEqual(parseLearningToolsState(JSON.stringify(raw)));
    expect(hasLearningToolsEntries({ notes: {}, confidence: {} })).toBe(false);
    expect(hasLearningToolsEntries({ notes: { one: "x" }, confidence: {} })).toBe(true);
    expect(hasLearningToolsEntries({ notes: {}, confidence: { one: "ready" } })).toBe(true);
  });

  it("builds a study guide from only notes and confidence entries", () => {
    const guide = buildStudyGuide(
      "Safety Basics",
      [block({ id: "one", title: "Intro" }), block({ id: "two", title: null, block_type: "quiz" })],
      { one: "Apply this on shift", two: "Line one\nLine two" },
      { two: "review" },
    );

    expect(guide).toContain("Study guide: Safety Basics");
    expect(guide).toContain("1. Intro");
    expect(guide).toContain("Takeaway: Apply this on shift");
    expect(guide).toContain("2. Knowledge check");
    expect(guide).toContain("Confidence: Review again");
    expect(guide).toContain("Line one\n             Line two");
  });
});
