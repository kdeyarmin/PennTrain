export function formatTimestampLabel(timestampMs: number | undefined, fallback = "Not refreshed yet"): string {
  if (!timestampMs || Number.isNaN(timestampMs)) return fallback;
  return new Date(timestampMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function latestQueryUpdatedAt(values: Array<number | undefined>): number | undefined {
  const valid = values.filter((value): value is number => typeof value === "number" && value > 0 && !Number.isNaN(value));
  return valid.length ? Math.max(...valid) : undefined;
}
