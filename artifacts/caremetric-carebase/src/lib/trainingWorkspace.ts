/** Training evidence readiness, not a facility licensing determination. Dates use PA local days. */
import type { StaffRegulatoryPolicy, EmployeeRegulatoryProfile } from "@/hooks/useStaffRegulatory";
export type StaffTrainingSummary = { start: string; end: string; graceThrough: string; basis: string; partialFirstYear: boolean;
  documented: boolean; completedHours: number; requiredHours: number; administratorHours: number; alrDementiaHours: number; specialUnitHours: number;
  previousYearOverdue?: boolean; previousCompletedHours?: number; graceHoursAllocatedToPrevious?: number;
  previousAlrDementiaOverdue?: boolean; previousSpecialUnitOverdue?: boolean; previousAdministratorOverdue?: boolean;
  previousPeriod?: {start: string; end: string; graceThrough: string; partialFirstYear: boolean} };
export type TrainingPolicy = {
  id: string; effective_from: string; year_basis: "fixed" | "anniversary"; year_start: string;
  administrator_year_basis: "fixed" | "anniversary"; administrator_year_start: string; policy_reference: string;
  created_at?: string;
};
/** Newest applicable revision: later effective date, then later save on that date. */
export function currentTrainingPolicy(policies: TrainingPolicy[], today: string) {
  return policies.filter(p => p.effective_from <= today).sort((a, b) =>
    b.effective_from.localeCompare(a.effective_from) || (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}
export type TrainingProfile = {
  employee_id: string; direct_care: boolean; administrator: boolean;
  specialty_unit: "none" | "pch_dementia" | "alr_dementia" | "alr_inrbi";
  duties: string; first_work_date: string; hire_date?: string | null;
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
  events: TrainingEvent[]; shifts: TrainingShift[]; plans: TrainingPlan[]; generated_at: string;
  staff_policy?: StaffRegulatoryPolicy | null; regulatory_profiles?: (EmployeeRegulatoryProfile & {employee_id: string})[];
  annual_summaries?: Record<string, StaffTrainingSummary> };
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
  chapter_requirements: "Applicable PCH / ALF chapter requirements", mobility: "Mobility needs and associated pressure injury, incontinence, nutrition and hydration care",
  behavioral_management: "Behavioral management", ancillary_orientation: "Ancillary job-specific orientation",
  dhs_initial_orientation: "Department-approved ALF initial orientation",
  initial_transfer: "Written verification of initial training at another facility (facility transfer policy applies)",
  dementia_behaviors: "Managing dementia-related behaviors", safe_environment: "Maintaining a safe care environment",
  brain_injury: "Brain injury and its cognitive, physical and behavioral effects", brain_injury_behaviors: "Managing brain-injury-related behaviors",
  rehabilitation: "Individualized rehabilitation and support-plan services", coaching: "Coaching, cueing, problem solving, self-soothing and fading supports",
  job_demonstration: "Job duties demonstrated", supervised_practice: "Supervised practice",
  dhs_direct_care: "Department-approved direct care course and competency test",
  first_aid: "First aid", cpr: "CPR", airway: "Airway obstruction",
  medication_authorization: "Approved medication course and performance test", diabetes: "Approved diabetes program",
  medication_practicum: "Annual medication administration practicum", medication_trainer: "Medication Train-the-Trainer",
  administrator_initial: "Administrator qualification and required initial training",
} as const;
export const TRAINING_ALLOCATIONS = {
  base: "Direct care annual", administrator: "Administrator annual", initial: "Initial direct care",
  dementia_initial: "ALF dementia initial", dementia_annual: "ALF dementia annual",
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
function beforeMonths(day: string, months: number): string {
  const [year, month, date] = dateParts(day);
  const index = year * 12 + month - 1 - months;
  return inYear(Math.floor(index / 12), `${String(index % 12 + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`);
}
/** A revision keeps the saved year; a first policy matches the fixed January 1 fields. */
export function trainingPolicyRevisionDefaults(policy: TrainingPolicy | undefined, today: string) {
  return {
    effective_from: today,
    year_basis: policy?.year_basis ?? "fixed",
    year_start: policy?.year_start ?? "01-01",
    administrator_year_basis: policy?.administrator_year_basis ?? "fixed",
    administrator_year_start: policy?.administrator_year_start ?? "01-01",
    policy_reference: policy?.policy_reference ?? "",
  };
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

/** RCG 64(c) / 65(e)/(h): source caps apply across the whole documented training year. */
export function eligibleTrainingMinutes(events: readonly TrainingEvent[], key: string, facilityType: string, policy?: StaffRegulatoryPolicy | null): number {
  const annual = key === "base" || key === "administrator";
  const limits: Record<string, number> = {
    medication: annual ? 360 : Infinity,
    resuscitation: annual ? 240 : Infinity,
    online: key === "administrator" ? 720 : Infinity,
    ojt: ["special_initial", "special_annual", "administrator"].includes(key) ? 0
      : key === "base" && facilityType === "PCH" ? 360 : key === "base" && facilityType === "ALR" && !policy?.alf_ojt_allowed ? 0 : Infinity,
  };
  const categories = (event: TrainingEvent) => [
    ...(event.topics.some(t => ["medication_authorization", "medication_practicum", "medication_trainer"].includes(t)) ? ["medication"] : []),
    ...(event.topics.some(topic => ["first_aid", "cpr", "airway"].includes(topic)) ? ["resuscitation"] : []),
    ...(["online", "ojt"].includes(event.delivery) ? [event.delivery] : []),
  ];
  // Count unrestricted delivery first so online medication/CPR does not displace otherwise
  // eligible in-person hours. Ties are stable, independent of the API's row ordering.
  const eligible = [...events].sort((a, b) =>
    Number(a.delivery === "online" || a.delivery === "ojt") - Number(b.delivery === "online" || b.delivery === "ojt")
    || categories(a).length - categories(b).length || a.completed_on.localeCompare(b.completed_on) || a.id.localeCompare(b.id));
  let total = 0;
  for (const event of eligible) {
    if (event.delivery === "online" && event.topics.some(topic => ["first_aid", "cpr", "airway"].includes(topic))) continue;
    const allocated = Number(event.allocations[key] || 0);
    if (!Number.isFinite(allocated) || allocated <= 0) continue;
    const caps = categories(event);
    const minutes = Math.min(allocated, ...caps.map(category => limits[category]));
    total += minutes;
    for (const category of caps) limits[category] -= minutes;
  }
  return total;
}
export type TrainingCheck = { key: string; label: string; citation: string; status: "met" | "missing" | "review";
  detail: string; due: string | null };
export function assessTraining(input: { profile?: TrainingProfile; policy?: TrainingPolicy; events: TrainingEvent[];
  shifts: TrainingShift[]; facilityType: string; today: string; hireDate?: string | null; medications?: boolean; insulin?: boolean;
  staffPolicy?: StaffRegulatoryPolicy | null; regulatoryProfile?: EmployeeRegulatoryProfile; annualSummary?: StaffTrainingSummary }): TrainingCheck[] {
  const { profile: p, policy, today } = input;
  const hireDate = p?.hire_date || input.hireDate;
  const checks: TrainingCheck[] = [];
  const add = (key: string, label: string, citation: string, met: boolean | null, detail: string, due: string | null = null) =>
    checks.push({ key, label, citation, status: met === null ? "review" : met ? "met" : "missing", detail, due });
  if (!p) { add("profile", "Confirm staff duties and audience", "2600/2800.65", null, "A job title does not establish regulatory applicability."); return checks; }
  const alr = input.facilityType === "ALR", pch = input.facilityType === "PCH", chapter = alr ? "2800" : "2600";
  if (!alr && !pch) { add("scope", "Facility license type", "2600/2800", null, "This workspace supports PCH and ALF facilities."); return checks; }
  const events = input.events.filter(e => e.employee_id === p.employee_id && e.status === "verified" && e.completed_on <= today);
  const has = (topic: string, from?: string, through = today) => events.some(e => e.topics.includes(topic) && (!from || e.completed_on >= from) && e.completed_on <= through);
  const missingTopics = (topics: string[], from?: string, through = today) => topics.filter(t => !has(t, from, through));
  const names = (topics: string[]) => topics.map(t => TRAINING_TOPICS[t as keyof typeof TRAINING_TOPICS] || t).join("; ") || "none";
  // 2600.63(b) / 2800.63(b) RCG: online training "with no hands-on practice ... will not be considered
  // when measuring compliance". The review RPC now refuses to verify it; this covers rows verified before.
  const current = (topic: string) => events.some(e => e.topics.includes(topic) && e.valid_until && e.valid_until >= today
    && !(e.delivery === "online" && ["first_aid", "cpr", "airway"].includes(topic)));
  const hours = (key: string, from: string, through: string) => {
    const eligible = events.filter(e => e.completed_on >= from && e.completed_on <= through);
    return eligibleTrainingMinutes(eligible, key, input.facilityType, input.staffPolicy) / 60;
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
      add("before_direct_care", "ALF prerequisites before any direct care", "2800.65(b)-(d)",
        has("dhs_initial_orientation") && current("first_aid") && current("cpr") ? null : false,
        "Department-approved initial orientation and current first-aid / CPR certificates are required. Verify completion before direct care and sufficient airway-certified shift coverage.", "Before direct care");
    }
    const topics = ["job_demonstration", "supervised_practice", "dhs_direct_care", "safe_management", "adls", "hygiene", "mental_health", "normal_aging", "assessment", "nutrition", "recreation", "gerontology", "resident_needs", "hazard_prevention", "universal_precautions", "chapter_requirements", "infection", ...(alr ? ["behavioral_management", "person_centered"] : ["dementia"])];
    const courseOnlyLegacy = Boolean(alr && input.regulatoryProfile?.continuous_service_since
      && input.regulatoryProfile.continuous_service_since <= "2007-10-31");
    const missing = missingTopics(courseOnlyLegacy ? topics.filter(topic => topic !== "dhs_direct_care") : topics);
    const transferMonths = input.staffPolicy ? input.staffPolicy.alf_transfer_months : 12;
    const transfer = has("initial_transfer", alr && transferMonths === null ? undefined : beforeMonths(p.first_work_date, alr ? transferMonths ?? 12 : 12), p.first_work_date);
    const legacyHire = Boolean(input.regulatoryProfile?.continuous_service_since && input.regulatoryProfile.continuous_service_since <= "2006-04-24");
    const licensed = Boolean(input.regulatoryProfile?.licensed_professional_exemption && input.regulatoryProfile.exemption_evidence.trim().length >= 5
      && input.regulatoryProfile.professional_exemption_valid_until && input.regulatoryProfile.professional_exemption_valid_until >= today);
    add("unsupervised", "Initial direct care and practical evidence", `${chapter}.65(${alr ? "g, k" : "d, h"})`,
      transfer || legacyHire || licensed || (missing.length === 0 && hours("initial", "0001-01-01", today) >= (alr ? 18 : 0)) ? null : false,
      `Missing topics: ${names(missing)}. ${alr ? "18 initial hours required. " : ""}Verify timing, supervised practice and authorization before unsupervised duties. Prior-facility exemptions need eligible training completed within the past year and written verification; historic PCH hires need applicability review.`, "Before unsupervised duties");
    conditionalTopic("staff_supervision", "staff_supervision", `${chapter}.65(${alr ? "g" : "d"})`);
    conditionalTopic("mobility_needs", "mobility", `${chapter}.65(${alr ? "g" : "d"})`);
  }
  const hireDue = hireDate ? addDays(hireDate, 30) : null;
  if (alr) add("dementia_initial", "ALF initial dementia instruction (all staff)", "2800.69", hireDate && hireDue ? hours("dementia_initial", hireDate, hireDue) >= 4 && has("dementia", hireDate, hireDue) : null,
    "4 additional hours within 30 days of hire. Use the employee's recorded hire date, which may differ from the first work date.", hireDue);
  const validUnit = p.specialty_unit !== "none" && (pch ? p.specialty_unit === "pch_dementia" : p.specialty_unit.startsWith("alr_"));
  if (p.specialty_unit !== "none" && !validUnit) add("unit", "Confirm specialty unit", `${chapter}.236`, null, "The selected unit does not match this license type.");
  const specialTopics = p.specialty_unit === "alr_inrbi" ? ["brain_injury", "brain_injury_behaviors", "communication", "adls", "safe_environment", "rehabilitation", "coaching"] : ["dementia", "dementia_behaviors", "communication", "adls", "safe_environment"];
  if (alr && p.direct_care && validUnit) add("special_initial", "Special unit initial instruction", "2800.236", hireDate && hireDue ? hours("special_initial", hireDate, hireDue) >= 8 && missingTopics(specialTopics, hireDate, hireDue).length === 0 : null,
    `8 hours within 30 days of hire, with population-specific topics: ${names(specialTopics)}. Structured training only -- on-the-job hours do not count. No automatic overlap credit.`, hireDue);
  if (!policy || policy.effective_from > today || ((!hireDate) && (policy.year_basis === "anniversary" || (p.administrator && policy.administrator_year_basis === "anniversary")))) {
    add("year", "Document the training-year policy and hire date", `${chapter}.65 / .66`, null, "Annual readiness needs a documented year basis and the hire date for an employment anniversary year.");
  } else {
    const period = trainingPeriod(today, hireDate || p.first_work_date, policy.year_basis, policy.year_start);
    const from = period.start > (hireDate || p.first_work_date) ? period.start : (hireDate || p.first_work_date);
    if (p.direct_care) {
      const earned = input.annualSummary?.completedHours ?? hours("base", from, today), required = alr ? 16 : 12;
      const partial = input.annualSummary?.partialFirstYear ?? Boolean(hireDate && hireDate > period.start);
      add("base", "Direct care annual hours", `${chapter}.65(${alr ? "h" : "e"})`, partial ? null : earned >= required, `${earned.toFixed(2)} / ${required} hours; ${from} through ${period.end}.${partial ? " Partial first training year: annual-hour inspection requirement begins with a full year." : ""} Medication training counts up to 6 hours; first aid, CPR and airway training together count up to 4 hours.`, input.annualSummary?.graceThrough ?? addDays(period.end, input.staffPolicy?.annual_grace_days ?? 15));
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
    if (alr) add("dementia_annual", "ALF annual dementia instruction", "2800.69", !hireDate || today < inYear(Number(hireDate.slice(0, 4)) + 1, hireDate.slice(5)) ? null : (input.annualSummary?.alrDementiaHours ?? hours("dementia_annual", from, today)) >= 2 && has("dementia", from),
      "2 additional hours annually thereafter; verify first-year applicability and documented training-year policy.", input.annualSummary?.graceThrough ?? addDays(period.end, input.staffPolicy?.annual_grace_days ?? 15));
    if (p.direct_care && validUnit) add("special_annual", "Special unit annual hours and topics", `${chapter}.236`, (input.annualSummary?.specialUnitHours ?? hours("special_annual", from, today)) >= (alr ? 8 : 6) && missingTopics(alr ? specialTopics : ["dementia"], from).length === 0,
      `Additional ${alr ? 8 : 6} hours of structured training for direct-care staff in this unit; on-the-job hours do not count. Required topics: ${names(alr ? specialTopics : ["dementia"])}.`, input.annualSummary?.graceThrough ?? addDays(period.end, input.staffPolicy?.annual_grace_days ?? 15));
    if (p.administrator) {
      const admin = trainingPeriod(today, hireDate || p.first_work_date, policy.administrator_year_basis, policy.administrator_year_start);
      const earned = input.annualSummary?.administratorHours ?? hours("administrator", admin.start, today);
      add("administrator", "Administrator annual eligible training", `${chapter}.64`, earned >= 24, `${earned.toFixed(2)} / 24 hours; online credit is capped at 12 hours, medication training at 6, and first aid / CPR / airway at 4. On-the-job hours do not count. Verify each source is Department-approved or otherwise eligible under ${chapter}.64(d), and annual applicability.`, admin.end);
    }
  }
  if (p.administrator) add("administrator_initial", "Administrator qualifications and initial pathway", `${chapter}.64`, has("administrator_initial") ? null : false,
    "Review qualifications, initial course, examination, orientation, timing and any eligible exemption. Annual instructor approval does not authorize initial training.");
  for (const [needed, topic, months, label] of [[input.medications, "medication_authorization", input.staffPolicy?.medication_course_years ? input.staffPolicy.medication_course_years * 12 : null, "Initial medication course"], [input.insulin, "diabetes", 12, "Insulin / diabetes instruction"]] as const) {
    if (needed) {
      const valid = events.some(e => {
        if (!e.topics.includes(topic)) return false;
        if (months === null) return true;
        if (!e.valid_until || addDays(e.valid_until, input.staffPolicy?.annual_grace_days ?? 15) < today) return false;
        const anniversary = inYear(Number(e.completed_on.slice(0, 4)) + months / 12, e.completed_on.slice(5));
        return today <= addDays(anniversary, input.staffPolicy?.annual_grace_days ?? 15);
      });
      add(topic, label, `${chapter}.190`, valid, "Approved program, qualified trainer, applicable performance evidence and current validity required. Verify any licensed-professional exception separately.");
    }
  }
  if (input.medications) add("medication_practicum", "Annual medication practicum", `${chapter}.190 RCG`, events.some(e =>
    e.topics.includes("medication_practicum") && e.completed_on.slice(0, 4) === today.slice(0, 4)),
    "The initial medication course remains valid under the RCG; complete the course-defined practicum each year. Retain observed-performance evidence.");
  if (input.annualSummary?.previousYearOverdue) add("previous_annual", "Previous training year remains deficient", `${chapter}.65 RCG`, false,
    `${input.annualSummary.previousCompletedHours ?? 0} / ${input.annualSummary.requiredHours} hours recorded for ${input.annualSummary.previousPeriod?.start} through ${input.annualSummary.previousPeriod?.end}. Starting a new year does not clear the prior deficiency.`, input.annualSummary.previousPeriod?.graceThrough ?? null);
  for (const [needed, key, label, citation] of [
    [alr && input.annualSummary?.previousAlrDementiaOverdue, "previous_dementia", "Previous annual dementia training remains deficient", `${chapter}.69`],
    [p.direct_care && validUnit && input.annualSummary?.previousSpecialUnitOverdue, "previous_special", "Previous special-unit training remains deficient", `${chapter}.236`],
    [p.administrator && input.annualSummary?.previousAdministratorOverdue, "previous_administrator", "Previous administrator training remains deficient", `${chapter}.64`],
  ] as const) if (needed) add(key, label, citation, false, "The previous full training year remains below its required hours after the documented grace period. Current-year progress does not erase that deficiency.");
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
