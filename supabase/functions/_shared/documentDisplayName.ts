export interface DocumentDisplayNameInput {
  title?: string | null;
  fileName?: string | null;
  fallback?: string;
}

const FILE_EXTENSION = /\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|md|rtf|zip|mp4|webm|mov|mp3|wav|vtt|srt|png|jpe?g|gif|webp|html?)$/i;
const UUID = /(?:^|[\s_])(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=$|[\s_])/gi;
const VERSION_SUFFIX = /(?:^|[\s_.–—-]+)(?:v(?:ersion)?|rev(?:ision)?)[\s_.-]*\d+(?:[._-]\d+)*(?:[\s_.-]+(?:final|draft|copy))?$/i;

/** Presentation only: never use this label as a Storage path, filename or evidence identifier. */
export function documentDisplayName({ title, fileName, fallback = "Document" }: DocumentDisplayNameInput): string {
  const preferred = title?.trim();
  const source = preferred || fileName?.trim();
  if (!source) return fallback;

  // Human-authored names keep their spelling, dates, digits and acronyms. Only
  // filename-like titles and explicit revision suffixes need presentation cleanup.
  const pathLike = !preferred || /^(?:https?:\/\/|[a-z]:[\\/]|\/)/i.test(source)
    || (FILE_EXTENSION.test(source) && /[\\/]/.test(source) && !/\s/.test(source));
  const fileLike = pathLike || FILE_EXTENSION.test(source) || /_/.test(source);
  if (!fileLike && !VERSION_SUFFIX.test(source) && !/^[0-9a-f-]{32,}$/i.test(source)) return source;

  let label = pathLike ? source.split(/[\\/]/).pop()?.split(/[?#]/)[0] ?? "" : source;
  try { label = decodeURIComponent(label); } catch { /* Keep malformed percent text readable. */ }
  label = label.replace(FILE_EXTENSION, "").replace(UUID, " ")
    .replace(/(?:^|[\s_])\d{10,13}(?=$|[\s_])/g, " ")
    .replace(/(?:^|[\s_])[0-9a-f]{16,}(?=$|[\s_])/gi, " ")
    .replace(VERSION_SUFFIX, "")
    .replace(/_+/g, " ").replace(/(?<=[A-Za-z])-(?=[A-Za-z])/g, " ")
    .replace(/^[\s.–—-]+|[\s.–—-]+$/g, "").replace(/\s+/g, " ").trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : fallback;
}
