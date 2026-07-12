import { describe, expect, it } from "vitest";
import {
  buildStudyGuide,
  estimateBlockMinutes,
  getBlockLabel,
  getTextPreview,
  lessonStorageKey,
  parseLearningToolsState,
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
  it("labels known course block types for learners", () => {
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
