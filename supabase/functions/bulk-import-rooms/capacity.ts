/**
 * Blank capacity is the one-bed default. A present cell must be a whole number
 * from 1 to 8. `parseInt(...) || 1` used to turn "0", "9", and "2 beds" into a
 * private room or a silently clamped 8-bed room.
 */
export function roomBedCount(
  raw: string | undefined,
): { ok: true; bedCount: number } | { ok: false; error: string } {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return { ok: true, bedCount: 1 };
  if (!/^[1-8]$/.test(trimmed)) {
    return { ok: false, error: "capacity must be a whole number from 1 to 8" };
  }
  return { ok: true, bedCount: Number(trimmed) };
}
