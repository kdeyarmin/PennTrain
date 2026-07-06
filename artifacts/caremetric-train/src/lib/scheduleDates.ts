// Small date-math helpers shared by the scheduling pages. All inputs/outputs are "yyyy-mm-dd"
// strings (matching the rest of the app's plain-native-Date convention -- no date-fns/dayjs
// dependency). Everything operates in UTC internally to avoid local-timezone off-by-one shifts
// when adding days to a bare date string.

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

// Monday of the week containing `iso` (ISO weekday convention: Monday start).
export function startOfWeekIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return isoDate(d);
}

export function enumerateDatesIso(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  let cur = startIso;
  while (cur <= endIso) {
    dates.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return dates;
}

export function formatDateLabel(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function formatTimeLabel(time: string): string {
  // time is "HH:MM:SS" from Postgres `time` columns.
  const [h, m] = time.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
