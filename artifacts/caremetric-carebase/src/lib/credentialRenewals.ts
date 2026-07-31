export function extractedFieldString(extracted: unknown, key: string): string {
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) return "";
  const value = (extracted as Record<string, unknown>)[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}


/** Age-based SLA label for renewal queue rows. */
export function renewalSlaLabel(createdAt: string, now = Date.now()): {
  level: "ok" | "warn" | "critical";
  label: string;
} {
  const ageMs = now - new Date(createdAt).getTime();
  const hours = ageMs / (60 * 60 * 1000);
  if (hours >= 72) return { level: "critical", label: ">72h" };
  if (hours >= 24) return { level: "warn", label: ">24h" };
  return { level: "ok", label: `${Math.max(0, Math.floor(hours))}h` };
}
