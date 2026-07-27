import { facilityToday } from "./dateUtils";

// Small date-math helpers shared by the scheduling pages. All inputs/outputs are "yyyy-mm-dd"
// strings (matching the rest of the app's plain-native-Date convention -- no date-fns/dayjs
// dependency).
//
// Mixed timezone behavior:
//   - todayIso() returns the FACILITY's calendar date (America/New_York, via facilityToday). It
//     used to return the browser's local date, on the reasoning that "today" should match the
//     user's wall clock. That is right for a clock widget and wrong for a schedule: a shift belongs
//     to the day the facility says it does, and after 20260727010100 the server agrees only with
//     the facility's day. The two answers differ for anyone not sitting in Pennsylvania.
//   - addDaysIso / startOfWeekIso / enumerateDatesIso / formatDateLabel all operate in UTC
//     internally to avoid local-timezone off-by-one shifts when doing arithmetic on bare date
//     strings. That is unchanged and is correct: they never ask what day it is now, they only shift
//     a "yyyy-mm-dd" that was already decided.

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return facilityToday();
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
