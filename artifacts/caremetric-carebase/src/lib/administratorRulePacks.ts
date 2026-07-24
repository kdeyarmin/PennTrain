import type { FacilityType } from "./facilityTypes";

export type AdministratorRuleStatus = "compliant" | "due_soon" | "expired" | "missing";

export interface AdministratorRulePackProfile {
  qualification_path?: string | null;
  hundred_hour_course_completed_date?: string | null;
  hundred_hour_course_document_path?: string | null;
  competency_test_passed?: boolean | null;
  competency_test_date?: string | null;
  nha_license_number?: string | null;
  nha_license_expiration?: string | null;
  regional_office_verification_submitted_date?: string | null;
  regional_office_verification_document_path?: string | null;
}

export interface AdministratorRulePackCeEntry {
  completed_date: string;
  hours: number;
  topic?: string | null;
}

export interface AdministratorRulePackEvidence {
  profile?: AdministratorRulePackProfile | null;
  ceEntries?: AdministratorRulePackCeEntry[];
  today: string;
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
}

const CE_WINDOW_DAYS = 365;
const DUE_SOON_DAYS = 30;

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00Z`).getTime();
  const end = new Date(`${endIso}T00:00:00Z`).getTime();
  return Math.ceil((end - start) / 86_400_000);
}

function statusFromDueDate(dueDate: string | null, today: string, present: boolean): AdministratorRuleStatus {
  if (!present) return "missing";
  if (!dueDate) return "compliant";
  if (dueDate < today) return "expired";
  if (daysBetween(today, dueDate) <= DUE_SOON_DAYS) return "due_soon";
  return "compliant";
}

function rollingCe(ceEntries: AdministratorRulePackCeEntry[], today: string) {
  const cutoff = addDays(today, -CE_WINDOW_DAYS);
  return ceEntries
    .filter((entry) => entry.completed_date >= cutoff && entry.completed_date <= today)
    .reduce((sum, entry) => sum + Number(entry.hours), 0);
}

export function buildAdministratorRulePack(facilityType: FacilityType, evidence: AdministratorRulePackEvidence): AdministratorRulePackRequirement[] {
  const profile = evidence.profile ?? null;
  const ceEntries = evidence.ceEntries ?? [];
  const isAlr = facilityType === "ALR";
  const commonCitation = isAlr ? "55 Pa. Code 2800.64" : "55 Pa. Code Ch. 2600 administrator requirements";
  const requirements: AdministratorRulePackRequirement[] = [];

  const qualifiedByCourse = Boolean(
    profile?.qualification_path === "hundred_hour_course"
    && profile.hundred_hour_course_completed_date
    && profile.hundred_hour_course_document_path
    && profile.competency_test_passed
    && profile.competency_test_date,
  );
  const qualifiedByNha = Boolean(
    profile?.qualification_path === "nha_exemption"
    && profile.nha_license_number
    && (!profile.nha_license_expiration || profile.nha_license_expiration >= evidence.today),
  );
  // The NHA license expiration only governs the NHA-exemption path; a stale
  // expiration date left on a course-qualified profile must not mark it expired.
  const nhaExpiration = profile?.qualification_path === "nha_exemption" ? profile?.nha_license_expiration ?? null : null;

  requirements.push({
    id: isAlr ? "alr-approved-course-test" : "pch-administrator-qualification",
    label: isAlr ? "ALF approved administrator course and competency test" : "PCH administrator qualification documentation",
    citation: commonCitation,
    facilityTypes: [facilityType],
    binderDestination: "Administrator Qualifications / Qualification Path",
    dueDate: nhaExpiration,
    status: statusFromDueDate(nhaExpiration, evidence.today, qualifiedByCourse || qualifiedByNha),
    detail: qualifiedByCourse
      ? "100-hour course, certificate, and competency test are documented."
      : qualifiedByNha
        ? "NHA exemption documentation is documented."
        : "Missing approved-course/test proof or current NHA exemption documentation.",
  });

  if (isAlr) {
    requirements.push({
      id: "alr-orientation-and-dementia",
      label: "ALF orientation and dementia-specific training documentation",
      citation: "55 Pa. Code 2800.64; Chapter 2800 dementia-care training references",
      facilityTypes: ["ALR"],
      binderDestination: "Administrator Qualifications / Orientation and Dementia Training",
      dueDate: null,
      status: profile?.hundred_hour_course_completed_date || profile?.nha_license_number ? "compliant" : "missing",
      detail: "Track ALF orientation, approved-course, competency, and dementia-specific administrator documentation together.",
    });
  }

  const ceCutoff = addDays(evidence.today, -CE_WINDOW_DAYS);
  const ceWindowEntries = ceEntries.filter((entry) => entry.completed_date >= ceCutoff && entry.completed_date <= evidence.today);
  const ceHours = rollingCe(ceEntries, evidence.today);
  // The CE requirement lapses on the first day the trailing-365-day total drops
  // below 24 hours, i.e. when enough of the oldest entries age out of the window.
  // Walking entries oldest-first, the due date is the last day the entry whose
  // aging-out drops the remaining total below 24 still counts (its date + 365).
  let ceDueDate: string | null = null;
  if (ceHours >= 24) {
    const sortedByDate = [...ceWindowEntries].sort((a, b) => a.completed_date.localeCompare(b.completed_date));
    let remaining = ceHours;
    for (const entry of sortedByDate) {
      remaining -= Number(entry.hours);
      if (remaining < 24) {
        ceDueDate = addDays(entry.completed_date, CE_WINDOW_DAYS);
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
    dueDate: ceDueDate,
    status: ceHours >= 24
      ? (ceDueDate && daysBetween(evidence.today, ceDueDate) <= DUE_SOON_DAYS ? "due_soon" : "compliant")
      : "missing",
    detail: `${ceHours.toFixed(1)} of 24 trailing-12-month CE hours documented.`,
  });

  requirements.push({
    id: "administrator-coverage",
    label: "Acting/designee/on-call coverage documentation",
    citation: commonCitation,
    facilityTypes: [facilityType],
    binderDestination: "Administrator Qualifications / Designee Coverage",
    dueDate: null,
    status: profile?.regional_office_verification_submitted_date || profile?.regional_office_verification_document_path ? "compliant" : "missing",
    detail: "Keep regional-office notice plus acting/designee/on-call coverage proof ready for survey.",
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
    const requirements = buildAdministratorRulePack(facilityType, { profile: null, ceEntries: [], today });
    return { requirements, summary: summarizeAdministratorRulePack(requirements) };
  }

  const candidates = profiles.map((profile) => {
    const requirements = buildAdministratorRulePack(facilityType, {
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
