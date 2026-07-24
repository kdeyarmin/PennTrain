// Care-level / billing review engine (task Area 8). Bridges a resident's assessed acuity to their
// BILLED level of care: it flags residents whose latest assessment postdates the rate that set their
// level-of-care charge, who have no rate or no assessment on file, or whose assessment is stale --
// prompting a human to confirm the billed care level still matches the resident's needs. It never
// asserts a mis-bill; it surfaces review signals from real data. Pure and unit-tested; the caller
// supplies rows already filtered by facility RLS.
import { daysUntil, formatDateForDisplay } from "@/lib/dateUtils";

export type CareLevelSeverity = "high" | "attention" | "info";
export type CareLevelStatus = CareLevelSeverity | "ok";

export type CareLevelFlagKind =
  | "no_rate_agreement"
  | "no_assessment_on_file"
  | "reassessed_since_rate"
  | "stale_assessment"
  | "zero_care_charge";

export interface CareLevelFlag {
  kind: CareLevelFlagKind;
  severity: CareLevelSeverity;
  message: string;
}

// PA support plans (55 Pa. Code Chapter 2600/2800) are reassessed at least annually; an assessment
// older than this substantiates the currently billed level of care only weakly.
export const STALE_ASSESSMENT_DAYS = 365;

const SEVERITY_RANK: Record<CareLevelSeverity, number> = { high: 3, attention: 2, info: 1 };
const STATUS_RANK: Record<CareLevelStatus, number> = { high: 3, attention: 2, info: 1, ok: 0 };

export interface RateAgreementLike {
  resident_id: string;
  level_of_care_charge: number;
  effective_from: string;
  version_number: number;
}
export interface AssessmentDateLike {
  resident_id: string;
  /** ISO date or timestamp of the assessment activity. */
  at: string | null;
}
export interface ResidentLike {
  id: string;
  first_name: string;
  last_name: string;
  room: string | null;
}

export interface CareLevelReviewRow {
  residentId: string;
  residentName: string;
  room: string | null;
  levelOfCareCharge: number | null;
  currentRateEffectiveFrom: string | null;
  rateVersion: number | null;
  lastAssessedAt: string | null;
  daysSinceAssessed: number | null;
  flags: CareLevelFlag[];
  status: CareLevelStatus;
}

/** Pick the operative (highest-version) rate agreement per resident. */
export function currentRatesByResident(rates: RateAgreementLike[]): Map<string, RateAgreementLike> {
  const current = new Map<string, RateAgreementLike>();
  for (const rate of rates) {
    const existing = current.get(rate.resident_id);
    if (!existing || rate.version_number > existing.version_number) current.set(rate.resident_id, rate);
  }
  return current;
}

/** Latest assessment-activity date per resident across every supplied source (clinical, RASP/ASP…). */
export function latestAssessmentByResident(...sources: AssessmentDateLike[][]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const source of sources) {
    for (const row of source) {
      if (!row.at) continue;
      const existing = latest.get(row.resident_id);
      if (!existing || new Date(row.at).getTime() > new Date(existing).getTime()) latest.set(row.resident_id, row.at);
    }
  }
  return latest;
}

// True when the assessment is strictly newer (by calendar day) than the rate's effective date, so the
// billed level of care predates the latest acuity information. Day-granular to avoid same-day noise.
function assessedAfterRate(lastAssessedAt: string, effectiveFrom: string): boolean {
  const d = daysUntil(effectiveFrom, new Date(lastAssessedAt));
  return d !== null && d < 0;
}

function worstStatus(flags: CareLevelFlag[]): CareLevelStatus {
  if (flags.length === 0) return "ok";
  return flags.reduce<CareLevelSeverity>(
    (worst, flag) => (SEVERITY_RANK[flag.severity] > SEVERITY_RANK[worst] ? flag.severity : worst),
    "info",
  );
}

export function computeResidentCareLevelReview(
  resident: ResidentLike,
  rate: RateAgreementLike | null,
  lastAssessedAt: string | null,
  today: Date = new Date(),
): CareLevelReviewRow {
  const flags: CareLevelFlag[] = [];
  const daysSince = lastAssessedAt ? -(daysUntil(lastAssessedAt, today) ?? 0) : null;

  if (!rate) {
    flags.push({
      kind: "no_rate_agreement",
      severity: "high",
      message: "No rate agreement on file — the resident's level of care and its charge are unrecorded.",
    });
  }
  if (!lastAssessedAt) {
    flags.push({
      kind: "no_assessment_on_file",
      severity: "high",
      message: "No assessment on file to substantiate a level of care.",
    });
  }
  if (rate && lastAssessedAt && assessedAfterRate(lastAssessedAt, rate.effective_from)) {
    flags.push({
      kind: "reassessed_since_rate",
      severity: "attention",
      message: `Assessed ${formatDateForDisplay(lastAssessedAt)}, after the current rate took effect ${formatDateForDisplay(rate.effective_from)} — confirm the level-of-care charge still matches.`,
    });
  }
  if (daysSince !== null && daysSince > STALE_ASSESSMENT_DAYS) {
    flags.push({
      kind: "stale_assessment",
      severity: "attention",
      message: `Last assessed ${formatDateForDisplay(lastAssessedAt)} (${daysSince} days ago) — an annual reassessment appears overdue.`,
    });
  }
  if (rate && rate.level_of_care_charge === 0) {
    flags.push({
      kind: "zero_care_charge",
      severity: "info",
      message: "Level-of-care charge is $0 — verify whether a care-level charge should apply.",
    });
  }

  return {
    residentId: resident.id,
    residentName: `${resident.last_name}, ${resident.first_name}`,
    room: resident.room,
    levelOfCareCharge: rate ? rate.level_of_care_charge : null,
    currentRateEffectiveFrom: rate ? rate.effective_from : null,
    rateVersion: rate ? rate.version_number : null,
    lastAssessedAt,
    daysSinceAssessed: daysSince,
    flags,
    status: worstStatus(flags),
  };
}

/** Join residents with their operative rate + latest assessment and score each. */
export function buildCareLevelReview(
  residents: ResidentLike[],
  rates: RateAgreementLike[],
  assessmentSources: AssessmentDateLike[][],
  today: Date = new Date(),
): CareLevelReviewRow[] {
  const currentRates = currentRatesByResident(rates);
  const lastAssessed = latestAssessmentByResident(...assessmentSources);
  return residents.map((resident) =>
    computeResidentCareLevelReview(resident, currentRates.get(resident.id) ?? null, lastAssessed.get(resident.id) ?? null, today),
  );
}

/** Only the residents that need review (status !== "ok"), worst first, then by name. */
export function careLevelWorklist(rows: CareLevelReviewRow[]): CareLevelReviewRow[] {
  return rows
    .filter((row) => row.status !== "ok")
    .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.residentName.localeCompare(b.residentName));
}

export interface CareLevelReviewSummary {
  total: number;
  needsReview: number;
  high: number;
  attention: number;
  info: number;
  ok: number;
}
export function summarizeCareLevelReview(rows: CareLevelReviewRow[]): CareLevelReviewSummary {
  const summary: CareLevelReviewSummary = { total: rows.length, needsReview: 0, high: 0, attention: 0, info: 0, ok: 0 };
  for (const row of rows) {
    summary[row.status] += 1;
    if (row.status !== "ok") summary.needsReview += 1;
  }
  return summary;
}

const STATUS_META: Record<CareLevelStatus, { label: string; badgeClass: string }> = {
  high: { label: "Action needed", badgeClass: "bg-destructive text-destructive-foreground hover:bg-destructive/80" },
  attention: { label: "Review due", badgeClass: "bg-warning text-warning-foreground hover:bg-warning/80" },
  info: { label: "Verify", badgeClass: "bg-info text-info-foreground hover:bg-info/80" },
  ok: { label: "Current", badgeClass: "bg-success text-success-foreground hover:bg-success/80" },
};
export function careLevelStatusLabel(status: string): string {
  return (STATUS_META as Record<string, { label: string }>)[status]?.label ?? status;
}
export function careLevelStatusBadgeClass(status: string): string {
  return (STATUS_META as Record<string, { badgeClass: string }>)[status]?.badgeClass ?? STATUS_META.info.badgeClass;
}
