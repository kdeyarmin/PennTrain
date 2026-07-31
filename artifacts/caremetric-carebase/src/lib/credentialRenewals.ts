export function extractedFieldString(extracted: unknown, key: string): string {
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) return "";
  const value = (extracted as Record<string, unknown>)[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
