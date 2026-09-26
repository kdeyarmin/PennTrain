import type { FacilityType } from "./facilityTypes";
import { trainingPeriod, type TrainingPolicy } from "./trainingWorkspace";
import { addFacilityCalendarDays, addFacilityCalendarYears, facilityDaysUntil, formatDateForDisplay } from "./dateUtils";

export type AdministratorRuleStatus = "compliant" | "due_soon" | "expired" | "missing";

export interface AdministratorRulePackProfile {
  qualification_path?: string | null;
  hundred_hour_course_completed_date?: string | null;
  hundred_hour_course_document_path?: string | null;
  competency_test_passed?: boolean | null;
  competency_test_date?: string | null;
  nha_license_number?: string | null;
  nha_license_expiration?: string | null;
  first_employed_as_administrator_on?: string | null;
  regional_office_verification_submitted_date?: string | null;
  regional_office_verification_document_path?: string | null;
  department_orientation_completed_date?: string | null;
  department_orientation_document_path?: string | null;
  dementia_initial_completed_date?: string | null;
  dementia_initial_hours?: number | null;
  dementia_initial_document_path?: string | null;
  dementia_annual_completed_date?: string | null;
  dementia_annual_hours?: number | null;
  dementia_annual_document_path?: string | null;
  legacy_no_break_over_one_year?: boolean;
  legacy_training_document_path?: string | null;
  competency_exemption_basis?: string | null;
  competency_exemption_evidence?: string | null;
  alf_supplement_completed_date?: string | null;
  alf_supplement_hours?: number | null;
  alf_supplement_test_passed?: boolean;
  alf_supplement_document_path?: string | null;
}

export interface AdministratorRulePackCeEntry {
  completed_date: string;
  hours: number;
  topic?: string | null;
  source?: string | null;
  credit_category?: string | null;
}

export interface AdministratorRulePackEvidence {
  profile?: AdministratorRulePackProfile | null;
  ceEntries?: AdministratorRulePackCeEntry[];
  today: string;
  trainingPolicy?: TrainingPolicy;
  annualGraceDays?: number;
}

export interface AdministratorRulePackRequirement {
  id: string;
  label: string;
  citation: string;
  facilityTypes: FacilityType[];
  binderDestination: string;
  dueDate: string | null;
  status: AdministratorRuleStatus;
  detail: string;
  earnedHours?: number;
}

const CE_WINDOW_DAYS = 365;
const DUE_SOON_DAYS = 30;

/**
 * A licensed nursing home administrator employed as an administrator before this date is exempt
 * from the chapter's training requirements; one hired later must pass the Department's
 * competency-based test (2600.64(g) / 2800.64(g)). 2800.64(g) exempts "prior to" January 18, 2011
 * and tests "after" it, naming neither side for the day itself, so a hire on the date is treated
 * as owing the test.
 */
export const NHA_EXEMPTION_EMPLOYED_BEFORE: Record<"PCH" | "ALR", string> = {
  PCH: "2006-10-24",
  ALR: "2011-01-18",
};

/** Facility-calendar days from `startIso` to `endIso` (both `YYYY-MM-DD`). */
function daysBetween(startIso: string, endIso: string): number {
  // Anchor `now` at noon UTC on the start day so facilityToday matches the date-only input.
  const anchor = new Date(`${startIso}T16:00:00Z`);
  return facilityDaysUntil(endIso, anchor) ?? 0;
}

function statusFromDueDate(dueDate: string | null, today: string, present: boolean): AdministratorRuleStatus {
  if (!present) return "missing";
  if (!dueDate) return "compliant";
  if (dueDate < today) return "expired";
  if (daysBetween(today, dueDate) <= DUE_SOON_DAYS) return "due_soon";
  return "compliant";
}

function rollingCe(ceEntries: AdministratorRulePackCeEntry[], today: string, from?: string) {
  const cutoff = from ?? addFacilityCalendarDays(today, -CE_WINDOW_DAYS);
  let medication = 6, resuscitation = 4, online = 12;
  return ceEntries.filter(entry => entry.completed_date >= cutoff && entry.completed_date <= today)
    .sort((a, b) => Number(/online|webinar/i.test(a.source ?? "")) - Number(/online|webinar/i.test(b.source ?? "")))
    .reduce((sum, entry) => {
      const isOnline = /online|webinar/i.test(entry.source ?? "");
      if (entry.credit_category === "resuscitation" && isOnline) return sum;
      const hours = Math.min(Number(entry.hours), isOnline ? online : Infinity, entry.credit_category === "medication" ? medication : Infinity,
        entry.credit_category === "resuscitation" ? resuscitation : Infinity);
      if (isOnline) online -= hours;
      if (entry.credit_category === "medication") medication -= hours;
      if (entry.credit_category === "resuscitation") resuscitation -= hours;
      return sum + hours;
    }, 0);
}

export function buildAdministratorRulePack(facilityType: FacilityType, evidence: AdministratorRulePackEvidence): AdministratorRulePackRequirement[] {
  const profile = evidence.profile ?? null;
  const ceEntries = evidence.ceEntries ?? [];
  const isAlr = facilityType === "ALR";
  const commonCitation = isAlr ? "55 Pa. Code 2800.64" : "55 Pa. Code 2600.64";
  const requirements: AdministratorRulePackRequirement[] = [];
  const firstEmployed = profile?.first_employed_as_administrator_on ?? null;
  const rcgTestExemption = Boolean(!isAlr && firstEmployed && firstEmployed < "2009-01-01"
    && profile?.competency_exemption_basis === "rcg_pre_2009" && profile.competency_exemption_evidence?.trim());
  const legacy = Boolean(profile?.qualification_path === "legacy_pch" && !isAlr && firstEmployed && firstEmployed < "2005-10-24"
    && profile.legacy_no_break_over_one_year && profile.legacy_training_document_path);
  const supplement = Boolean(profile?.qualification_path === "pch_course_supplement" && isAlr
    && ((profile.hundred_hour_course_completed_date && profile.hundred_hour_course_document_path)
      || (profile.legacy_training_document_path && profile.legacy_no_break_over_one_year))
    && profile.alf_supplement_completed_date && profile.alf_supplement_completed_date <= evidence.today
    && Number(profile.alf_supplement_hours) >= 15 && profile.alf_supplement_test_passed && profile.alf_supplement_document_path);

  const qualifiedByCourse = Boolean(
    profile?.qualification_path === "hundred_hour_course"
    && profile.hundred_hour_course_completed_date
    && profile.hundred_hour_course_document_path
    && profile.hundred_hour_course_completed_date <= evidence.today
    && ((profile.competency_test_passed && profile.competency_test_date && profile.competency_test_date <= evidence.today) || rcgTestExemption),
  );
  const nhaLicenseCurrent = Boolean(
    profile?.qualification_path === "nha_exemption"
    && profile.nha_license_number
    && (!profile.nha_license_expiration || profile.nha_license_expiration >= evidence.today),
  );
  const nhaCutoff = rcgTestExemption ? "2009-01-01" : NHA_EXEMPTION_EMPLOYED_BEFORE[isAlr ? "ALR" : "PCH"];
  const nhaSection = isAlr ? "2800.64(g)" : "2600.64(g)";
  const nhaTestRecorded = Boolean(profile?.competency_test_passed && profile?.competency_test_date);
  const nhaEmployedBeforeCutoff = Boolean(firstEmployed && firstEmployed < nhaCutoff);
  const qualifiedByNha = nhaLicenseCurrent && (nhaTestRecorded || nhaEmployedBeforeCutoff);
  // The NHA license expiration only governs the NHA-exemption path; a stale
  // expiration date left on a course-qualified profile must not mark it expired.
  const nhaExpiration = profile?.qualification_path === "nha_exemption" ? profile?.nha_license_expiration ?? null : null;

  let qualificationDetail: string;
  if (legacy) {
    qualificationDetail = "Pre-October 24, 2005 PCH administrator service and legacy training evidence are documented, with no break longer than one year.";
  } else if (supplement) {
    qualificationDetail = "Prior PCH administrator course and the 15-hour assisted-living supplement, related competency test and evidence are documented (2800 RCG).";
  } else if (qualifiedByCourse) {
    qualificationDetail = "100-hour course, certificate, and competency test are documented.";
  } else if (!nhaLicenseCurrent) {
    qualificationDetail = "Missing approved-course/test proof or current NHA exemption documentation.";
  } else if (nhaTestRecorded) {
    qualificationDetail = "NHA exemption and the Department competency test are documented.";
  } else if (nhaEmployedBeforeCutoff) {
    qualificationDetail = `NHA license is current and this administrator was first employed as an administrator on ${formatDateForDisplay(firstEmployed)}, before ${formatDateForDisplay(nhaCutoff)}, so ${nhaSection} exempts them from the chapter's training requirements while the license stays current.`;
  } else if (firstEmployed) {
    qualificationDetail = `This NHA was first employed as an administrator on ${formatDateForDisplay(firstEmployed)}. ${nhaSection} exempts only an NHA employed as administrator before ${formatDateForDisplay(nhaCutoff)}; record the passed Department competency-based test and its date.`;
  } else {
    qualificationDetail = `Record when this NHA was first employed as an administrator, or the passed Department competency-based test and its date. ${nhaSection} exempts only an NHA employed as administrator before ${formatDateForDisplay(nhaCutoff)}; one hired later must pass the test.`;
  }

  requirements.push({
    id: isAlr ? "alr-approved-course-test" : "pch-administrator-qualification",
    label: isAlr ? "ALF approved administrator course and competency test" : "PCH administrator qualification documentation",
    citation: commonCitation,
    facilityTypes: [facilityType],
    binderDestination: "Administrator Qualifications / Qualification Path",
    dueDate: nhaExpiration,
    status: statusFromDueDate(nhaExpiration, evidence.today, qualifiedByCourse || qualifiedByNha || legacy || supplement),
    detail: qualificationDetail,
  });

  if (isAlr) {
    const orientation = qualifiedByNha || Boolean(profile?.department_orientation_completed_date
      && profile.department_orientation_completed_date <= evidence.today && profile.department_orientation_document_path);
    const initialDementia = Boolean(profile?.dementia_initial_completed_date
      && profile.dementia_initial_completed_date <= evidence.today && Number(profile.dementia_initial_hours) >= 4
      && profile.dementia_initial_document_path);
    const annualDementia = Boolean(profile?.dementia_annual_completed_date
      && profile.dementia_annual_completed_date <= evidence.today
      && addFacilityCalendarYears(profile.dementia_annual_completed_date, 1) >= evidence.today
      && Number(profile.dementia_annual_hours) >= 2 && profile.dementia_annual_document_path);
    const firstYear = Boolean(firstEmployed && firstEmployed <= evidence.today
      && evidence.today < addFacilityCalendarYears(firstEmployed, 1));
    const initialOnTime = Boolean(firstEmployed && profile?.dementia_initial_completed_date
      && profile.dementia_initial_completed_date >= firstEmployed
      && profile.dementia_initial_completed_date <= addFacilityCalendarDays(firstEmployed, 30));
    requirements.push({
      id: "alr-orientation-and-dementia",
      label: "ALF orientation and dementia-specific training documentation",
      citation: "55 Pa. Code 2800.64(a); 2800.69",
      facilityTypes: ["ALR"],
      binderDestination: "Administrator Qualifications / Orientation and Dementia Training",
      dueDate: null,
      status: orientation && initialDementia && initialOnTime && (firstYear || annualDementia) ? "compliant" : "missing",
      detail: "Record Department orientation separately, and dated evidence of 4 dementia hours within 30 days of initial employment plus 2 hours annually thereafter. A course date or NHA license alone does not establish this evidence. The training is additional to the 100-hour course; retain the basis for any exemption.",
    });
  }

  const selectedPeriod = evidence.trainingPolicy ? trainingPeriod(evidence.today, firstEmployed ?? evidence.today,
    evidence.trainingPolicy.administrator_year_basis, evidence.trainingPolicy.administrator_year_start) : null;
  const ceCutoff = selectedPeriod?.start ?? addFacilityCalendarDays(evidence.today, -CE_WINDOW_DAYS);
  const ceWindowEntries = ceEntries.filter((entry) => entry.completed_date >= ceCutoff && entry.completed_date <= evidence.today);
  let ceHours = rollingCe(ceEntries, evidence.today, selectedPeriod?.start);
  const courseFirstYear = Boolean(qualifiedByCourse && firstEmployed && firstEmployed <= evidence.today
    && profile?.hundred_hour_course_completed_date && profile.hundred_hour_course_completed_date <= firstEmployed
    && evidence.today < addFacilityCalendarYears(firstEmployed, 1));
  const previousPeriod = selectedPeriod && evidence.trainingPolicy ? trainingPeriod(addFacilityCalendarDays(selectedPeriod.start, -1),
    firstEmployed ?? evidence.today, evidence.trainingPolicy.administrator_year_basis, evidence.trainingPolicy.administrator_year_start) : null;
  let priorOverdue = false;
  if (previousPeriod && firstEmployed && firstEmployed <= previousPeriod.start
    && !(qualifiedByCourse && addFacilityCalendarYears(firstEmployed, 1) > previousPeriod.end)) {
    const priorBeforeGrace = rollingCe(ceEntries, previousPeriod.end, previousPeriod.start);
    const graceEnd = addFacilityCalendarDays(previousPeriod.end, evidence.annualGraceDays ?? 15);
    const through = evidence.today < graceEnd ? evidence.today : graceEnd;
    const repair = Math.min(Math.max(0, 24 - priorBeforeGrace), Math.max(0, rollingCe(ceEntries, through, previousPeriod.start) - priorBeforeGrace));
    ceHours = Math.max(0, ceHours - repair);
    priorOverdue = evidence.today > graceEnd && priorBeforeGrace + repair < 24;
  }
  // The CE requirement lapses on the first day the trailing-365-day total drops
  // below 24 hours, i.e. when enough of the oldest entries age out of the window.
  // Walking entries oldest-first, the due date is the last day the entry whose
  // aging-out drops the remaining total below 24 still counts (its date + 365).
  let ceDueDate: string | null = selectedPeriod ? addFacilityCalendarDays(selectedPeriod.end, evidence.annualGraceDays ?? 15) : null;
  if (ceHours >= 24 && !selectedPeriod) {
    const sortedByDate = [...ceWindowEntries].sort((a, b) => a.completed_date.localeCompare(b.completed_date));
    for (const entry of sortedByDate) {
      const candidate = addFacilityCalendarDays(entry.completed_date, CE_WINDOW_DAYS);
      if (rollingCe(ceWindowEntries, addFacilityCalendarDays(candidate, 1)) < 24) {
        ceDueDate = candidate;
        break;
      }
    }
  }

  requirements.push({
    id: "administrator-continuing-education",
    label: `${isAlr ? "ALF" : "PCH"} administrator continuing education`,
    citation: commonCitation,
    facilityTypes: [facilityType],
    binderDestination: "Administrator Qualifications / Continuing Education",
    dueDate: courseFirstYear ? addFacilityCalendarYears(firstEmployed!, 1) : ceDueDate,
    earnedHours: ceHours,
    status: priorOverdue ? "expired" : courseFirstYear ? "compliant" : ceHours >= 24
      ? (ceDueDate && daysBetween(evidence.today, ceDueDate) <= DUE_SOON_DAYS ? "due_soon" : "compliant")
      : "missing",
    detail: priorOverdue ? `The previous full training year (${previousPeriod?.start} through ${previousPeriod?.end}) remains below 24 hours after grace. Current-year progress does not clear it.` : courseFirstYear
      ? "The documented approved initial course fulfills the annual training requirement for the first year of employment under 64(c)."
      : `${ceHours.toFixed(1)} of 24 eligible CE hours documented${selectedPeriod ? ` for ${selectedPeriod.start} through ${selectedPeriod.end}, with ${evidence.annualGraceDays ?? 15} grace days` : " in the trailing 12 months"}.`,
  });

  requirements.push({
    id: "administrator-coverage",
    label: "Acting/designee/on-call coverage documentation",
    citation: isAlr ? "55 Pa. Code 2800.56; 2800.64(e)" : "55 Pa. Code 2600.56; 2600.64(e)",
    facilityTypes: [facilityType],
    binderDestination: "Administrator Qualifications / Designee Coverage",
    dueDate: null,
    status: profile?.regional_office_verification_submitted_date || profile?.regional_office_verification_document_path ? "compliant" : "missing",
    detail: isAlr
      ? "Keep the written verification sent to the Department's assisted living licensing office, plus proof the administrator averages 36 hours a week on site (30 during normal business hours) and the written designee and on-call assignments for absences."
      : "Keep the written verification sent to the regional office, plus proof the administrator averages 20 hours a week on site in each calendar month.",
  });

  return requirements;
}

export function summarizeAdministratorRulePack(requirements: AdministratorRulePackRequirement[]) {
  const blocking = requirements.filter((rule) => rule.status === "missing" || rule.status === "expired");
  const dueSoon = requirements.filter((rule) => rule.status === "due_soon");
  return {
    total: requirements.length,
    ready: blocking.length === 0,
    blockingCount: blocking.length,
    dueSoonCount: dueSoon.length,
    status: blocking.length > 0 ? "needs_attention" as const : dueSoon.length > 0 ? "due_soon" as const : "inspection_ready" as const,
  };
}

export interface BestAdministratorRulePackInput {
  profiles: Array<AdministratorRulePackProfile & { id: string }>;
  ceEntries: Array<AdministratorRulePackCeEntry & { administrator_profile_id: string }>;
  today: string;
  trainingPolicy?: TrainingPolicy;
  annualGraceDays?: number;
}

/**
 * Administrator profiles are organization-scoped with no facility binding, so
 * facility-level readiness views evaluate every profile (each with its own CE
 * entries) and report the best-qualified administrator rather than an arbitrary
 * first row. Falls back to an empty-profile evaluation when none exist.
 */
export function buildBestAdministratorRulePack(facilityType: FacilityType, input: BestAdministratorRulePackInput) {
  const { profiles, ceEntries, today } = input;
  if (profiles.length === 0) {
    const requirements = buildAdministratorRulePack(facilityType, { profile: null, ceEntries: [], today, trainingPolicy: input.trainingPolicy, annualGraceDays: input.annualGraceDays });
    return { requirements, summary: summarizeAdministratorRulePack(requirements) };
  }

  const candidates = profiles.map((profile) => {
    const requirements = buildAdministratorRulePack(facilityType, {
      trainingPolicy: input.trainingPolicy, annualGraceDays: input.annualGraceDays,
      profile,
      ceEntries: ceEntries.filter((entry) => entry.administrator_profile_id === profile.id),
      today,
    });
    return { requirements, summary: summarizeAdministratorRulePack(requirements) };
  });

  return candidates.reduce((best, candidate) =>
    candidate.summary.blockingCount < best.summary.blockingCount
      || (candidate.summary.blockingCount === best.summary.blockingCount && candidate.summary.dueSoonCount < best.summary.dueSoonCount)
      ? candidate
      : best,
  );
}
