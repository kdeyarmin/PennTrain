import type { CourseBlock } from "@/hooks/useCourses";
import type { TrainingDocument } from "@/hooks/useDocuments";
import { documentDisplayName as readableDocumentName } from "@/lib/documentDisplayName";

export function blockName(block: Pick<CourseBlock, "title" | "sort_order">) {
  return readableDocumentName({ title: block.title, fallback: `Block ${block.sort_order + 1}` });
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

export function documentDisplayName(document: Pick<TrainingDocument, "file_name" | "storage_path"> | undefined, title?: string | null) {
  if (!document) return "";
  return readableDocumentName({ title, fileName: document.file_name, fallback: "Course document" });
}
