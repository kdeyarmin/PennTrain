/** Training evidence readiness, not a facility licensing determination. Dates use PA local days. */
export type TrainingPolicy = {
  id: string; effective_from: string; year_basis: "fixed" | "anniversary"; year_start: string;
  administrator_year_basis: "fixed" | "anniversary"; administrator_year_start: string; policy_reference: string;
};
export type TrainingProfile = {
  employee_id: string; direct_care: boolean; administrator: boolean;
  specialty_unit: "none" | "pch_dementia" | "alr_dementia" | "alr_inrbi";
  duties: string; first_work_date: string;
};
export type TrainingEvent = {
  id: string; employee_id: string; title: string; completed_on: string; completed_at?: string | null; minutes: number;
  delivery: string; provider: string; source_reference: string; provider_qualification: string;
  topics: string[]; allocations: Record<string, number>; valid_until: string | null;
  status: "pending" | "verified" | "rejected" | "void"; review_note: string | null;
  evidence_document_id: string | null; course_assignment_id: string | null;
};
export type TrainingShift = { id: string; employee_id: string; starts_at: string; ends_at: string; source_reference: string };
export type TrainingPlan = { id: string; employee_id: string; title: string; duties_snapshot: string;
  scheduled_at: string; duration_minutes: number; location: string; requirement_keys: string[];
  completed_event_id: string | null; canceled_at: string | null };
export type TrainingWorkspace = { policies: TrainingPolicy[]; profiles: TrainingProfile[];
  events: TrainingEvent[]; shifts: TrainingShift[]; plans: TrainingPlan[]; generated_at: string };
export const TRAINING_TOPICS = {
  fire: "Fire safety", emergency: "Emergency preparedness", rights: "Resident rights",
  abuse: "Abuse reporting / OAPSA", incidents: "Incident reporting", falls: "Falls and accidents",
  med_self_admin: "Medication self-administration", resident_needs: "Resident needs", dementia: "Dementia",
  infection: "Infection control", personal_care: "Personal care", safe_management: "Safe management",
  mental_health: "Mental illness and cognitive impairment", new_population: "New population needs",
  person_centered: "Person-centered care", communication: "Communication", nutrition: "Nutrition and hydration",
  job_demonstration: "Job duties demonstrated", supervised_practice: "Supervised practice",
  dhs_direct_care: "Department-approved direct care course and competency test",
  first_aid: "First aid", cpr: "CPR", airway: "Airway obstruction",
  medication_authorization: "Approved medication course and performance test", diabetes: "Approved diabetes program",
  administrator_initial: "Administrator qualification and required initial training",
} as const;
export const TRAINING_ALLOCATIONS = {
  base: "Direct care annual", administrator: "Administrator annual", initial: "Initial direct care",
  dementia_initial: "ALR dementia initial", dementia_annual: "ALR dementia annual",
  special_initial: "Special unit initial", special_annual: "Special unit annual",
} as const;
export function paDay(instant = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}
function dateParts(day: string) { return day.split("-").map(Number); }
function utcDay(day: string): Date { const [y, m, d] = dateParts(day); return new Date(Date.UTC(y, m - 1, d)); }
function dayString(date: Date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`; }
export function addDays(day: string, days: number) { const date = utcDay(day); date.setUTCDate(date.getUTCDate() + days); return dayString(date); }
function inYear(year: number, monthDay: string): string {
  const [m, d] = monthDay.split("-").map(Number);
  // A February 29 anniversary falls on February 28 in a non-leap year.
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
export function trainingPeriod(today: string, firstWork: string, basis: string, start: string) {
  const monthDay = basis === "anniversary" ? firstWork.slice(5) : start;
  let year = Number(today.slice(0, 4));
  if (inYear(year, monthDay) > today) year--;
  return { start: inYear(year, monthDay), end: addDays(inYear(year + 1, monthDay), -1) };
}
/** Exact fortieth scheduled hour; insufficient shifts must remain unknown. */
export function fortiethWorkHour(shifts: TrainingShift[], firstWork: string): string | null {
  let milliseconds = 40 * 60 * 60 * 1000;
  let previousEnd = -Infinity;
  for (const shift of [...shifts].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const start = Date.parse(shift.starts_at), end = Date.parse(shift.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < previousEnd) return null;
    previousEnd = end;
    if (paDay(new Date(start)) < firstWork) continue;
    if (end - start >= milliseconds) return new Date(start + milliseconds).toISOString();
    milliseconds -= end - start;
  }
  return null;
}
export type TrainingCheck = { key: string; label: string; citation: string; status: "met" | "missing" | "review";
  detail: string; due: string | null };
export function assessTraining(input: { profile?: TrainingProfile; policy?: TrainingPolicy; events: TrainingEvent[];
  shifts: TrainingShift[]; facilityType: string; today: string; medications?: boolean; insulin?: boolean }): TrainingCheck[] {
  const { profile: p, policy, today } = input;
  const checks: TrainingCheck[] = [];
  const add = (key: string, label: string, citation: string, met: boolean | null, detail: string, due: string | null = null) =>
    checks.push({ key, label, citation, status: met === null ? "review" : met ? "met" : "missing", detail, due });
  if (!p) { add("profile", "Confirm staff duties and audience", "2600/2800.65", null, "A job title does not establish regulatory applicability."); return checks; }
  const alr = input.facilityType === "ALR", pch = input.facilityType === "PCH", chapter = alr ? "2800" : "2600";
  if (!alr && !pch) { add("scope", "Facility license type", "2600/2800", null, "This workspace supports PCH and ALR facilities."); return checks; }
  const events = input.events.filter(e => e.employee_id === p.employee_id && e.status === "verified" && e.completed_on <= today);
  const has = (topic: string, from?: string, through = today) => events.some(e => e.topics.includes(topic) && (!from || e.completed_on >= from) && e.completed_on <= through);
  const hours = (key: string, from: string, through: string) => {
    const eligible = events.filter(e => e.completed_on >= from && e.completed_on <= through);
    const regular = eligible.filter(e => e.delivery !== "ojt").reduce((s, e) => s + (e.allocations[key] || 0), 0);
    const ojt = eligible.filter(e => e.delivery === "ojt").reduce((s, e) => s + (e.allocations[key] || 0), 0);
    return (regular + (pch && key === "base" ? Math.min(360, ojt) : ojt)) / 60;
  };
  add("day1", "First-day fire and emergency instruction", `${chapter}.65(a)`,
    has("fire", undefined, p.first_work_date) && has("emergency", undefined, p.first_work_date), "Verify facility-specific first-day instruction and instructor qualifications.", p.first_work_date);
  const forty = fortiethWorkHour(input.shifts.filter(s => s.employee_id === p.employee_id), p.first_work_date);
  const orientation = ["rights", "emergency", "abuse", "incidents", ...(alr ? ["person_centered", "communication", "nutrition"] : [])];
  const missingOrientation = orientation.filter(t => !has(t, undefined, forty ? paDay(new Date(forty)) : today));
  const orientationInTime = forty && orientation.every(topic => events.some(e => e.topics.includes(topic) && (
    e.completed_on < paDay(new Date(forty)) || (e.completed_at && Date.parse(e.completed_at) <= Date.parse(forty)))));
  add("40hours", "Orientation within 40 scheduled work hours", `${chapter}.65(b)`, forty ? (missingOrientation.length ? false : orientationInTime ? true : null) : null,
    forty ? `Deadline ${forty}; missing topics: ${missingOrientation.join(", ") || "none"}. Same-day completion requires time verification.` : "Enter enough actual scheduled shifts to establish the deadline.", forty ? paDay(new Date(forty)) : null);
  if (p.direct_care) {
    const topics = ["job_demonstration", "supervised_practice", "dhs_direct_care", "falls", "med_self_admin", "resident_needs", "dementia", "infection", "personal_care", "safe_management", ...(alr ? ["first_aid", "cpr", "airway"] : [])];
    const missing = topics.filter(t => !has(t));
    add("unsupervised", "Initial direct care and practical evidence", `${chapter}.65`,
      missing.length === 0 && hours("initial", "0001-01-01", today) >= (alr ? 18 : 0) ? null : false,
      `Missing topics: ${missing.join(", ") || "none"}. Supervisor must authorize duties and confirm completion preceded unsupervised work.`, "Before unsupervised duties");
  }
  if (alr) {
    const due = addDays(p.first_work_date, 30);
    add("dementia_initial", "ALR initial dementia instruction (all staff)", "2800.69", hours("dementia_initial", p.first_work_date, due) >= 4, "4 additional hours within 30 days.", due);
  }
  if (p.specialty_unit !== "none") {
    const validUnit = pch ? p.specialty_unit === "pch_dementia" : p.specialty_unit.startsWith("alr_");
    if (!validUnit) add("unit", "Confirm specialty unit", `${chapter}.236`, null, "The selected unit does not match this license type.");
    if (alr) add("special_initial", "Special unit initial instruction", "2800.236", hours("special_initial", p.first_work_date, addDays(p.first_work_date, 30)) >= 8,
      "8 hours specific to the special care population; hours are not reused for other requirements.", addDays(p.first_work_date, 30));
  }
  if (!policy || policy.effective_from > today) {
    add("year", "Document the training-year policy", `${chapter}.65 / .66`, null, "Annual readiness cannot be determined without a documented year basis.");
  } else {
    const period = trainingPeriod(today, p.first_work_date, policy.year_basis, policy.year_start);
    const from = period.start > p.first_work_date ? period.start : p.first_work_date;
    if (p.direct_care) {
      const earned = hours("base", from, today), required = alr ? 16 : 12;
      add("base", "Direct care annual hours", `${chapter}.65`, earned >= required, `${earned.toFixed(2)} / ${required} hours; ${from} through ${period.end}.`, period.end);
      const topics = ["med_self_admin", "abuse", "rights", "emergency", "mental_health", "infection", "new_population", ...(alr ? ["person_centered", "communication", "nutrition"] : [])];
      const missing = topics.filter(t => !has(t, from));
      add("annual_topics", "Annual topics and population review", `${chapter}.65`, missing.length === 0, `Missing: ${missing.join(", ") || "none"}. Record a needs review even when the population is unchanged.`, period.end);
    }
    add("annual_fire", "Annual qualified fire-safety instruction", `${chapter}.65`, has("fire", from), "Retain instructor qualifications and completion evidence.", period.end);
    if (alr) add("dementia_annual", "ALR annual dementia instruction", "2800.69", today < inYear(Number(p.first_work_date.slice(0, 4)) + 1, p.first_work_date.slice(5)) ? null : hours("dementia_annual", from, today) >= 2,
      "2 additional hours in subsequent years; initial-year applicability requires review.", period.end);
    if (p.specialty_unit !== "none" && (alr || p.direct_care)) add("special_annual", "Special unit annual hours", `${chapter}.236`, hours("special_annual", from, today) >= (alr ? 8 : 6), `Additional ${alr ? 8 : 6} hours; no automatic overlap credit.`, period.end);
    if (p.administrator) {
      const admin = trainingPeriod(today, p.first_work_date, policy.administrator_year_basis, policy.administrator_year_start);
      const earned = hours("administrator", admin.start, today);
      add("administrator", "Administrator annual eligible training", `${chapter}.64`, earned >= 24, `${earned.toFixed(2)} / 24 hours; verify approved or otherwise eligible sources.`, admin.end);
      add("administrator_initial", "Administrator qualifications and initial pathway", `${chapter}.64`, has("administrator_initial"), "Retain course, test, orientation, qualifications and any applicable exemption evidence.");
    }
  }
  for (const [needed, topic, months, label] of [[input.medications, "medication_authorization", 24, "Medication authorization"], [input.insulin, "diabetes", 12, "Insulin / diabetes instruction"]] as const) {
    if (needed) {
      const valid = events.some(e => {
        if (!e.topics.includes(topic) || !e.valid_until || e.valid_until < today) return false;
        const date = utcDay(e.completed_on); date.setUTCMonth(date.getUTCMonth() + months);
        return today < dayString(date);
      });
      add(topic, label, `${chapter}.190`, valid, "Approved program, qualified trainer, applicable performance evidence and current validity required.");
    }
  }
  return checks;
}

/** Spreadsheet-safe export; inspector packets remain labeled evidence reports. */
export function trainingCsv(rows: unknown[][]) {
  return "\uFEFF" + rows.map(row => row.map(value => {
    let s = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n");
}
