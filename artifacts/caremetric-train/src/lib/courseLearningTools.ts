export type LessonConfidence = "unsure" | "review" | "ready";

export interface LearningToolsState {
  notes: Record<string, string>;
  confidence: Record<string, LessonConfidence>;
}

export interface LearningToolBlock {
  id: string;
  title: string | null;
  block_type: string;
  body: unknown;
}

export const CONFIDENCE_LABEL: Record<LessonConfidence, string> = {
  unsure: "I need help",
  review: "Review again",
  ready: "Ready to use this",
};

const EMPTY_LEARNING_TOOLS_STATE: LearningToolsState = { notes: {}, confidence: {} };

export function isLessonConfidence(value: unknown): value is LessonConfidence {
  return value === "unsure" || value === "review" || value === "ready";
}

export function parseLearningToolsState(raw: string | null): LearningToolsState {
  if (!raw) return EMPTY_LEARNING_TOOLS_STATE;

  try {
    const parsed = JSON.parse(raw) as { notes?: unknown; confidence?: unknown };
    const notes: Record<string, string> = {};
    const confidence: Record<string, LessonConfidence> = {};

    if (parsed.notes && typeof parsed.notes === "object" && !Array.isArray(parsed.notes)) {
      Object.entries(parsed.notes).forEach(([blockId, value]) => {
        if (typeof value === "string") notes[blockId] = value;
      });
    }

    if (parsed.confidence && typeof parsed.confidence === "object" && !Array.isArray(parsed.confidence)) {
      Object.entries(parsed.confidence).forEach(([blockId, value]) => {
        if (isLessonConfidence(value)) confidence[blockId] = value;
      });
    }

    return { notes, confidence };
  } catch {
    return EMPTY_LEARNING_TOOLS_STATE;
  }
}

export function getBlockLabel(blockType: string | null | undefined) {
  switch (blockType) {
    case "text": return "Reading";
    case "video": return "Video";
    case "pdf": return "Document";
    case "scorm": return "Interactive";
    case "quiz": return "Knowledge check";
    default: return "Lesson";
  }
}

export function estimateBlockMinutes(block: Pick<LearningToolBlock, "block_type" | "body"> | undefined) {
  if (!block) return 1;
  if (block.block_type === "video") return 5;
  if (block.block_type === "pdf" || block.block_type === "scorm") return 4;
  if (block.block_type === "quiz") return 3;
  const content = (block.body as { content?: string } | null)?.content ?? "";
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 180));
}

export function getTextPreview(block: Pick<LearningToolBlock, "body"> | undefined) {
  const content = (block?.body as { content?: string } | null)?.content?.trim();
  if (!content) return null;
  const firstLine = content.split(/\n+/).map(line => line.trim()).find(Boolean);
  if (!firstLine) return null;
  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
}

export function lessonStorageKey(assignmentId: string | undefined) {
  return assignmentId ? `caremetric:course-learning-tools:${assignmentId}` : null;
}

export function buildStudyGuide(
  courseTitle: string,
  blocks: LearningToolBlock[],
  notes: Record<string, string>,
  confidence: Record<string, LessonConfidence>,
) {
  const lines = [`Study guide: ${courseTitle}`, ""];
  blocks.forEach((block, index) => {
    const note = notes[block.id]?.trim();
    const confidenceLabel = confidence[block.id] ? CONFIDENCE_LABEL[confidence[block.id]] : null;
    if (!note && !confidenceLabel) return;
    lines.push(`${index + 1}. ${block.title ?? getBlockLabel(block.block_type)}`);
    if (confidenceLabel) lines.push(`   Confidence: ${confidenceLabel}`);
    if (note) lines.push(`   Takeaway: ${note.replace(/\n/g, "\n             ")}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}
