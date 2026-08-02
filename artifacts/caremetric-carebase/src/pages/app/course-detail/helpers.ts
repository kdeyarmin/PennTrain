import type { CourseBlock } from "@/hooks/useCourses";
import type { TrainingDocument } from "@/hooks/useDocuments";

export function blockName(block: Pick<CourseBlock, "title" | "sort_order">) {
  return block.title?.trim() || `Block ${block.sort_order + 1}`;
}

export function textBodyContent(block: Pick<CourseBlock, "body">) {
  const body = block.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const content = (body as { content?: unknown }).content;
  return typeof content === "string" ? content.trim() : "";
}

export function videoTranscriptContent(block: Pick<CourseBlock, "body">) {
  const body = block.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const { transcript, script } = body as { transcript?: unknown; script?: unknown };
  if (typeof transcript === "string" && transcript.trim()) return transcript.trim();
  if (typeof script === "string" && script.trim()) return script.trim();
  return "";
}

export function documentDisplayName(document: Pick<TrainingDocument, "file_name" | "storage_path"> | undefined) {
  if (!document) return "";
  return document.file_name || document.storage_path.split("/").pop() || "Attached document";
}
