/** Training evidence readiness, not a facility licensing determination. Dates use PA local days. */
export type TrainingPolicy = {
  id: string; effective_from: string; year_basis: "fixed" | "anniversary"; year_start: string;
  administrator_year_basis: "fixed" | "anniversary"; administrator_year_start: string; policy_reference: string;
};
export type TrainingProfile = {
  employee_id: string; direct_care: boolean; administrator: boolean;
  specialty_unit: "none" | "pch_dementia" | "alr_dementia" | "alr_inrbi";
  duties: string; first_work_date: string;
  applicability?: Partial<Record<"ancillary" | "annual_common" | "staff_supervision" | "mobility_needs" | "mental_health_population" | "new_population", boolean>>;
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
  facility_orientation: "Facility-specific first-day fire and emergency instruction (all required procedures)",
  fire: "Qualified annual fire safety", emergency: "Emergency preparedness and crisis response", medical_emergency: "Emergency medical plan", rights: "Resident rights",
  abuse: "Abuse reporting / OAPSA", incidents: "Incident reporting", falls: "Falls and accidents",
  med_self_admin: "Medication self-administration", resident_needs: "Assessed resident needs and support plans", dementia: "Dementia, cognitive and neurological impairment",
  infection: "Infection signs and control, hygiene and immobility-related care", personal_care: "Personal care / assisted living service needs", safe_management: "Safe management",
  mental_health: "Mental illness, intellectual disability and neurological / other mental impairments", new_population: "New population needs",
  person_centered: "Person-centered care and aging in place", communication: "Communication, relationships and problem solving", nutrition: "Nutrition, resident preferences, food handling and sanitation",
  adls: "Assistance with ADLs and IADLs", hygiene: "Personal hygiene", normal_aging: "Normal cognitive, psychological and functional aging",
  assessment: "Assessment and support-plan implementation", recreation: "Recreation, socialization and community resources", gerontology: "Gerontology",
  staff_supervision: "Staff supervision", hazard_prevention: "Safety and hazard prevention", universal_precautions: "Universal precautions",
  chapter_requirements: "Applicable PCH / ALR chapter requirements", mobility: "Mobility needs and associated pressure injury, incontinence, nutrition and hydration care",
  behavioral_management: "Behavioral management", ancillary_orientation: "Ancillary job-specific orientation",
  dhs_initial_orientation: "Department-approved ALR initial orientation",
  initial_transfer: "Written verification of eligible initial training at another facility within the past year",
  dementia_behaviors: "Managing dementia-related behaviors", safe_environment: "Maintaining a safe care environment",
  brain_injury: "Brain injury and its cognitive, physical and behavioral effects", brain_injury_behaviors: "Managing brain-injury-related behaviors",
  rehabilitation: "Individualized rehabilitation and support-plan services", coaching: "Coaching, cueing, problem solving, self-soothing and fading supports",
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
  for (const shift of [...shifts].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))) {
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
  shifts: TrainingShift[]; facilityType: string; today: string; hireDate?: string | null; medications?: boolean; insulin?: boolean }): TrainingCheck[] {
  const { profile: p, policy, today, hireDate } = input;
  const checks: TrainingCheck[] = [];
  const add = (key: string, label: string, citation: string, met: boolean | null, detail: string, due: string | null = null) =>
    checks.push({ key, label, citation, status: met === null ? "review" : met ? "met" : "missing", detail, due });
  if (!p) { add("profile", "Confirm staff duties and audience", "2600/2800.65", null, "A job title does not establish regulatory applicability."); return checks; }
  const alr = input.facilityType === "ALR", pch = input.facilityType === "PCH", chapter = alr ? "2800" : "2600";
  if (!alr && !pch) { add("scope", "Facility license type", "2600/2800", null, "This workspace supports PCH and ALR facilities."); return checks; }
  const events = input.events.filter(e => e.employee_id === p.employee_id && e.status === "verified" && e.completed_on <= today);
  const has = (topic: string, from?: string, through = today) => events.some(e => e.topics.includes(topic) && (!from || e.completed_on >= from) && e.completed_on <= through);
  const missingTopics = (topics: string[], from?: string, through = today) => topics.filter(t => !has(t, from, through));
  const names = (topics: string[]) => topics.map(t => TRAINING_TOPICS[t as keyof typeof TRAINING_TOPICS] || t).join("; ") || "none";
  const current = (topic: string) => events.some(e => e.topics.includes(topic) && e.valid_until && e.valid_until >= today);
  const hours = (key: string, from: string, through: string) => {
    const eligible = events.filter(e => e.completed_on >= from && e.completed_on <= through);
    const regular = eligible.filter(e => e.delivery !== "ojt").reduce((s, e) => s + (e.allocations[key] || 0), 0);
    const ojt = eligible.filter(e => e.delivery === "ojt").reduce((s, e) => s + (e.allocations[key] || 0), 0);
    return (regular + (pch && key === "base" ? Math.min(360, ojt) : ojt)) / 60;
  };
  const conditionalTopic = (key: keyof NonNullable<TrainingProfile["applicability"]>, topic: string, citation: string, from?: string, due: string | null = null) => {
    if (p.applicability?.[key] === false) return;
    add(`conditional_${key}`, TRAINING_TOPICS[topic as keyof typeof TRAINING_TOPICS], citation,
      has(topic, from) ? true : p.applicability?.[key] === true ? false : null,
      "Confirm applicability in the duty profile and retain the basis; if applicable, record the required instruction.", due);
  };
  add("day1", "First-day facility fire and emergency instruction", `${chapter}.65(a)`,
    has("facility_orientation", undefined, p.first_work_date),
    "Evidence must cover evacuation, emergency duties and transport, meeting places, smoking rules, extinguishers, alarms and emergency calls for this facility.", p.first_work_date);
  const forty = fortiethWorkHour(input.shifts.filter(s => s.employee_id === p.employee_id), p.first_work_date);
  const orientation = ["rights", "medical_emergency", "abuse", "incidents", ...(alr ? ["safe_management", "person_centered", "communication", "nutrition"] : [])];
  const missingOrientation = missingTopics(orientation, undefined, forty ? paDay(new Date(forty)) : today);
  const orientationInTime = forty && orientation.every(topic => events.some(e => e.topics.includes(topic) && (
    e.completed_on < paDay(new Date(forty)) || (e.completed_at && Date.parse(e.completed_at) <= Date.parse(forty)))));
  add("40hours", "Orientation within 40 scheduled work hours", `${chapter}.65(${alr ? "e" : "b"})`, forty ? (missingOrientation.length ? false : orientationInTime ? true : null) : null,
    forty ? `Deadline ${forty}; missing topics: ${names(missingOrientation)}. Same-day completion requires time verification.` : `Enter enough actual scheduled shifts to establish the deadline. Required topics: ${names(orientation)}.`, forty ? paDay(new Date(forty)) : null);
  if (p.applicability?.ancillary !== false && (!p.direct_care || p.applicability?.ancillary)) {
    add("ancillary", "Ancillary job orientation before working in that capacity", `${chapter}.65(${alr ? "f" : "c"})`,
      has("ancillary_orientation") ? null : p.applicability?.ancillary ? false : null,
      "Confirm ancillary duties and that job-specific orientation preceded those duties.", "Before ancillary duties");
  }
  if (p.direct_care) {
    if (alr) {
      add("before_direct_care", "ALR prerequisites before any direct care", "2800.65(b)-(d)",
        has("dhs_initial_orientation") && current("first_aid") && current("cpr") ? null : false,
        "Department-approved initial orientation and current first-aid / CPR certificates are required. Verify completion before direct care and sufficient airway-certified shift coverage.", "Before direct care");
    }
    const topics = ["job_demonstration", "supervised_practice", "dhs_direct_care", "safe_management", "adls", "hygiene", "mental_health", "normal_aging", "assessment", "nutrition", "recreation", "gerontology", "resident_needs", "hazard_prevention", "universal_precautions", "chapter_requirements", "infection", ...(alr ? ["behavioral_management", "person_centered"] : ["dementia"])];
    const missing = missingTopics(topics);
    const transfer = has("initial_transfer", addDays(p.first_work_date, -366), p.first_work_date);
    const legacyHire = pch && (!hireDate || hireDate <= "2006-04-24");
    add("unsupervised", "Initial direct care and practical evidence", `${chapter}.65(${alr ? "g, k" : "d, h"})`,
      transfer || legacyHire || (missing.length === 0 && hours("initial", "0001-01-01", today) >= (alr ? 18 : 0)) ? null : false,
      `Missing topics: ${names(missing)}. ${alr ? "18 initial hours required. " : ""}Verify timing, supervised practice and authorization before unsupervised duties. Prior-facility exemptions need eligible training completed within the past year and written verification; historic PCH hires need applicability review.`, "Before unsupervised duties");
    conditionalTopic("staff_supervision", "staff_supervision", `${chapter}.65(${alr ? "g" : "d"})`);
    conditionalTopic("mobility_needs", "mobility", `${chapter}.65(${alr ? "g" : "d"})`);
  }
  const hireDue = hireDate ? addDays(hireDate, 30) : null;
  if (alr) add("dementia_initial", "ALR initial dementia instruction (all staff)", "2800.69", hireDate && hireDue ? hours("dementia_initial", hireDate, hireDue) >= 4 && has("dementia", hireDate, hireDue) : null,
    "4 additional hours within 30 days of hire. Use the employee's recorded hire date, which may differ from the first work date.", hireDue);
  const validUnit = p.specialty_unit !== "none" && (pch ? p.specialty_unit === "pch_dementia" : p.specialty_unit.startsWith("alr_"));
  if (p.specialty_unit !== "none" && !validUnit) add("unit", "Confirm specialty unit", `${chapter}.236`, null, "The selected unit does not match this license type.");
  const specialTopics = p.specialty_unit === "alr_inrbi" ? ["brain_injury", "brain_injury_behaviors", "communication", "adls", "safe_environment", "rehabilitation", "coaching"] : ["dementia", "dementia_behaviors", "communication", "adls", "safe_environment"];
  if (alr && p.direct_care && validUnit) add("special_initial", "Special unit initial instruction", "2800.236", hireDate && hireDue ? hours("special_initial", hireDate, hireDue) >= 8 && missingTopics(specialTopics, hireDate, hireDue).length === 0 : null,
    `8 hours within 30 days of hire, with population-specific topics: ${names(specialTopics)}. No automatic overlap credit.`, hireDue);
  if (!policy || policy.effective_from > today || ((!hireDate) && (policy.year_basis === "anniversary" || (p.administrator && policy.administrator_year_basis === "anniversary")))) {
    add("year", "Document the training-year policy and hire date", `${chapter}.65 / .66`, null, "Annual readiness needs a documented year basis and the hire date for an employment anniversary year.");
  } else {
    const period = trainingPeriod(today, hireDate || p.first_work_date, policy.year_basis, policy.year_start);
    const from = period.start > (hireDate || p.first_work_date) ? period.start : (hireDate || p.first_work_date);
    if (p.direct_care) {
      const earned = hours("base", from, today), required = alr ? 16 : 12;
      add("base", "Direct care annual hours", `${chapter}.65(${alr ? "h" : "e"})`, earned >= required, `${earned.toFixed(2)} / ${required} hours; ${from} through ${period.end}.`, period.end);
      const missing = missingTopics(["med_self_admin", "resident_needs", "dementia", "infection", "personal_care", "safe_management"], from);
      add("annual_topics", "Direct care annual topics", `${chapter}.65(${alr ? "i" : "f"})`, missing.length === 0, `Missing: ${names(missing)}.`, period.end);
      conditionalTopic("mental_health_population", "mental_health", `${chapter}.65(${alr ? "i" : "f"})`, from, period.end);
    }
    if (p.direct_care || p.applicability?.annual_common !== false) {
      const missing = missingTopics(["fire", "emergency", "rights", "abuse", "falls"], from);
      add("annual_common", "Annual common staff topics", `${chapter}.65(${alr ? "j" : "g"})`, !p.direct_care && p.applicability?.annual_common === undefined ? null : missing.length === 0,
        `Direct care, ancillary, substitutes and regularly scheduled volunteers: missing ${names(missing)}. Fire instruction requires the qualified expert or trained on-site instructor. Confirm audience in the duty profile.`, period.end);
      conditionalTopic("new_population", "new_population", `${chapter}.65(${alr ? "j" : "g"})`, from, period.end);
    }
    if (alr) add("dementia_annual", "ALR annual dementia instruction", "2800.69", !hireDate || today < inYear(Number(hireDate.slice(0, 4)) + 1, hireDate.slice(5)) ? null : hours("dementia_annual", from, today) >= 2 && has("dementia", from),
      "2 additional hours annually thereafter; verify first-year applicability and documented training-year policy.", period.end);
    if (p.direct_care && validUnit) add("special_annual", "Special unit annual hours and topics", `${chapter}.236`, hours("special_annual", from, today) >= (alr ? 8 : 6) && missingTopics(alr ? specialTopics : ["dementia"], from).length === 0,
      `Additional ${alr ? 8 : 6} hours for direct-care staff in this unit. Required topics: ${names(alr ? specialTopics : ["dementia"])}.`, period.end);
    if (p.administrator) {
      const admin = trainingPeriod(today, hireDate || p.first_work_date, policy.administrator_year_basis, policy.administrator_year_start);
      const earned = hours("administrator", admin.start, today);
      add("administrator", "Administrator annual eligible training", `${chapter}.64`, earned >= 24, `${earned.toFixed(2)} / 24 hours; verify approved or otherwise eligible sources and annual applicability.`, admin.end);
    }
  }
  if (p.administrator) add("administrator_initial", "Administrator qualifications and initial pathway", `${chapter}.64`, has("administrator_initial") ? null : false,
    "Review qualifications, initial course, examination, orientation, timing and any eligible exemption. Annual instructor approval does not authorize initial training.");
  for (const [needed, topic, months, label] of [[input.medications, "medication_authorization", 24, "Medication authorization"], [input.insulin, "diabetes", 12, "Insulin / diabetes instruction"]] as const) {
    if (needed) {
      const valid = events.some(e => {
        if (!e.topics.includes(topic) || !e.valid_until || e.valid_until < today) return false;
        const date = utcDay(e.completed_on); date.setUTCMonth(date.getUTCMonth() + months);
        return today < dayString(date);
      });
      add(topic, label, `${chapter}.190`, valid, "Approved program, qualified trainer, applicable performance evidence and current validity required. Verify any licensed-professional exception separately.");
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

export function trainingActionError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "The training action could not be completed. Please retry.";
}
