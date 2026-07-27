/**
 * Field-level care conflict detection (program plan Phase 3b).
 *
 * Replaces the untyped `support_plan_proposals.conflict_warnings text[]` with conflicts that name
 * their source record, the record they disagree with, the date, who is responsible, and what to do
 * about it. The request is explicit that each conflict must offer accept / correct / document an
 * exception; those dispositions are persisted separately (see `resident_care_conflict_dispositions`),
 * because a conflict is DERIVED from records and must re-derive cleanly rather than be stored and
 * go stale.
 *
 * Detection is pure and runs over records the resident record already loads. Every rule states what
 * disagrees with what and cites both sides -- no rule reports a conflict it cannot show the evidence
 * for, and no rule produces a score.
 *
 * The comparison vocabulary comes from assessmentTemplates.ts's `comparesTo` fields, whose option
 * values are asserted identical to the coded values in residentCareHeader.ts. That parity is what
 * makes "assessment says two-person, header says one-person" a computable statement rather than a
 * string match.
 */
import type { ComparableAnswer } from "./assessmentTemplates";

export type CareConflictKind =
  | "transfer_assistance_mismatch"
  | "diet_texture_mismatch"
  | "documented_assistance_exceeds_plan"
  | "fall_risk_without_intervention"
  | "plan_predates_hospital_return";

export type CareConflictSeverity = "high" | "attention";

export interface CareConflictRecordRef {
  label: string;
  /** ISO date or timestamp the record is dated. */
  at: string | null;
  href?: string;
}

export interface CareConflict {
  /**
   * Stable across re-derivations of the same disagreement, so a recorded disposition keeps
   * suppressing it. Deliberately excludes free text: rewording a note must not resurrect a
   * conflict somebody already resolved.
   */
  key: string;
  kind: CareConflictKind;
  severity: CareConflictSeverity;
  title: string;
  source: CareConflictRecordRef;
  conflicting: CareConflictRecordRef;
  recommendedResolution: string;
  responsibleRole: string;
}

export interface ActivePlanLike {
  id: string;
  version_number: number;
  state: string;
  effective_date: string | null;
  services?: unknown;
  interventions?: unknown;
}

export interface ServiceExceptionLike {
  /** Task instance status, e.g. resident_refused / not_completed. */
  status: string;
  service_name: string;
  at: string | null;
  /** Structured exception payload; the assistance-level key arrives with the floor phase. */
  assistance_level?: string | null;
}

export interface CareHeaderValues {
  transferAssistance: string;
  fallRisk: string;
  dietTexture: string | null;
  /** When the dietary profile was last effective, for citing the conflicting record. */
  dietAsOf: string | null;
}

export interface HospitalReturnLike {
  episodeId: string;
  returnedAt: string | null;
  /** True when the return recorded changes to condition, diet, or mobility. */
  recordedChanges: boolean;
}

export interface CareConflictInput {
  residentId: string;
  residentHref: string;
  header: CareHeaderValues;
  /** Comparable answers from the most recent finalized review, with its date and label. */
  reviewAnswers: ComparableAnswer[];
  reviewLabel: string | null;
  reviewDate: string | null;
  activePlan: ActivePlanLike | null;
  serviceExceptions: ServiceExceptionLike[];
  hospitalReturn: HospitalReturnLike | null;
  now?: Date;
}

/** Ordering of transfer assistance from least to most support required. */
const TRANSFER_RANK: Record<string, number> = {
  independent: 0,
  supervision: 1,
  one_person: 2,
  two_person: 3,
  mechanical_lift: 4,
};

/** Texture ordering from least to most modified. */
const TEXTURE_RANK: Record<string, number> = {
  regular: 0,
  soft_and_bite_sized: 1,
  minced_and_moist: 2,
  pureed: 3,
  liquidized: 4,
};

const FALL_RISK_RANK: Record<string, number> = { low: 0, moderate: 1, high: 2 };

/** Exception statuses that evidence a resident needing more help than planned. */
const MORE_ASSISTANCE_STATUSES = new Set(["completed_late", "not_completed"]);

/** How many exceptions in the window before staff documentation contradicts the plan. */
export const DOCUMENTED_ASSISTANCE_THRESHOLD = 3;
export const DOCUMENTED_ASSISTANCE_WINDOW_DAYS = 14;

/**
 * The local calendar day an instant falls on, as "YYYY-MM-DD".
 *
 * Needed because DATE columns (`effective_date`) carry no time while `timestamptz` columns do, and
 * comparing the two directly is a category error: `new Date("2026-07-26")` is UTC midnight, so a
 * same-day return recorded at 09:00 EDT (13:00Z) looks LATER than a plan effective that day.
 * Everything here is reduced to a calendar day first, and "YYYY-MM-DD" strings compare correctly
 * with `<` because the format is fixed-width and big-endian.
 */
function localCalendarDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

function asEntries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
}

function entryText(entry: Record<string, unknown>): string {
  return Object.values(entry)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function planMentions(plan: ActivePlanLike | null, pattern: RegExp): boolean {
  if (!plan) return false;
  return [...asEntries(plan.services), ...asEntries(plan.interventions)]
    .some((entry) => pattern.test(entryText(entry)));
}

/** Transfer assistance the plan's services describe, if any state one explicitly. */
function planTransferLevel(plan: ActivePlanLike | null): string | null {
  if (!plan) return null;
  const entries = [...asEntries(plan.services), ...asEntries(plan.interventions)];
  for (const entry of entries) {
    const explicit = entry.transfer_assistance;
    if (typeof explicit === "string" && explicit in TRANSFER_RANK) return explicit;
    // `requires_two_staff` is the field the service generator already writes, so honour it.
    if (entry.requires_two_staff === true) return "two_person";
  }
  for (const entry of entries) {
    const text = entryText(entry);
    if (/two[-\s]?person|2[-\s]?person|two staff/.test(text)) return "two_person";
    if (/mechanical lift|hoyer/.test(text)) return "mechanical_lift";
    if (/one[-\s]?person|1[-\s]?person/.test(text)) return "one_person";
    if (/supervis/.test(text)) return "supervision";
  }
  return null;
}

function daysBetween(from: string | null | undefined, now: Date): number | null {
  if (!from) return null;
  const at = new Date(from);
  if (Number.isNaN(at.getTime())) return null;
  return Math.floor((now.getTime() - at.getTime()) / 86_400_000);
}

function answerFor(answers: ComparableAnswer[], attribute: string): ComparableAnswer | undefined {
  return answers.find((entry) => entry.attribute === attribute);
}

export function detectResidentCareConflicts(input: CareConflictInput): CareConflict[] {
  const now = input.now ?? new Date();
  const conflicts: CareConflict[] = [];
  const reviewRef = (): CareConflictRecordRef => ({
    label: input.reviewLabel ?? "Most recent assessment review",
    at: input.reviewDate,
    href: `${input.residentHref}?tab=assessments`,
  });

  // 1. Assessment says two-person transfer; the plan says one-person assistance.
  const assessedTransfer = answerFor(input.reviewAnswers, "transfer_assistance");
  const plannedTransfer = planTransferLevel(input.activePlan);
  if (assessedTransfer && plannedTransfer
    && TRANSFER_RANK[assessedTransfer.value] !== undefined
    && TRANSFER_RANK[plannedTransfer] !== undefined
    && TRANSFER_RANK[assessedTransfer.value] > TRANSFER_RANK[plannedTransfer]) {
    conflicts.push({
      key: `transfer:${input.activePlan!.id}:${assessedTransfer.value}:${plannedTransfer}`,
      kind: "transfer_assistance_mismatch",
      severity: "high",
      title: "Assessment requires more transfer help than the plan provides",
      source: reviewRef(),
      conflicting: {
        label: `Support plan v${input.activePlan!.version_number}`,
        at: input.activePlan!.effective_date,
        href: `${input.residentHref}?tab=support-plan`,
      },
      recommendedResolution:
        "Revise the plan's transfer services to match the assessed level, or correct the assessment if it is wrong.",
      responsibleRole: "Administrator",
    });
  }

  // 2. Assessment records a modified-texture diet; the dietary profile says something less modified.
  const assessedTexture = answerFor(input.reviewAnswers, "diet_texture");
  const headerTexture = input.header.dietTexture;
  if (assessedTexture && headerTexture
    && TEXTURE_RANK[assessedTexture.value] !== undefined
    && TEXTURE_RANK[headerTexture] !== undefined
    && TEXTURE_RANK[assessedTexture.value] > TEXTURE_RANK[headerTexture]) {
    conflicts.push({
      key: `diet:${assessedTexture.value}:${headerTexture}`,
      kind: "diet_texture_mismatch",
      severity: "high",
      title: "Assessed diet texture is more modified than the dietary profile",
      source: reviewRef(),
      conflicting: {
        label: "Dietary profile",
        at: input.header.dietAsOf,
        href: `/app/dietary-operations?resident=${input.residentId}`,
      },
      recommendedResolution:
        "Update the dietary profile to the assessed texture, or correct the assessment. A texture change that never reaches the kitchen is a choking risk.",
      responsibleRole: "Facility manager",
    });
  }

  // 3. Staff documentation repeatedly shows more assistance than the plan describes.
  const windowStart = now.getTime() - DOCUMENTED_ASSISTANCE_WINDOW_DAYS * 86_400_000;
  const recentAssistanceExceptions = input.serviceExceptions.filter((exception) => {
    const at = exception.at ? new Date(exception.at).getTime() : NaN;
    if (Number.isNaN(at) || at < windowStart) return false;
    if (exception.assistance_level) return true;
    return MORE_ASSISTANCE_STATUSES.has(exception.status);
  });
  if (recentAssistanceExceptions.length >= DOCUMENTED_ASSISTANCE_THRESHOLD
    && input.activePlan
    && plannedTransfer !== null
    && TRANSFER_RANK[plannedTransfer] <= TRANSFER_RANK.supervision) {
    conflicts.push({
      key: `documented-assistance:${input.activePlan.id}:${recentAssistanceExceptions.length}`,
      kind: "documented_assistance_exceeds_plan",
      severity: "attention",
      title: "Staff documentation shows more assistance than the plan describes",
      source: {
        label: `${recentAssistanceExceptions.length} service exceptions in ${DOCUMENTED_ASSISTANCE_WINDOW_DAYS} days`,
        at: recentAssistanceExceptions[0]?.at ?? null,
        href: `${input.residentHref}?tab=care`,
      },
      conflicting: {
        label: `Support plan v${input.activePlan.version_number} (${plannedTransfer.replace(/_/g, " ")})`,
        at: input.activePlan.effective_date,
        href: `${input.residentHref}?tab=support-plan`,
      },
      recommendedResolution:
        "Reassess the resident's assistance level, or document why the plan level remains correct despite the exceptions.",
      responsibleRole: "Facility manager",
    });
  }

  // 4. A fall risk is documented but the active plan contains no fall intervention.
  const assessedFallRisk = answerFor(input.reviewAnswers, "fall_risk");
  const effectiveFallRisk = assessedFallRisk?.value ?? input.header.fallRisk;
  const fallRiskRank = FALL_RISK_RANK[effectiveFallRisk];
  if (fallRiskRank !== undefined && fallRiskRank >= FALL_RISK_RANK.moderate) {
    const hasFallIntervention = planMentions(input.activePlan, /fall|ambulat|transfer|mobility|safety check/);
    if (!hasFallIntervention) {
      conflicts.push({
        key: `fall-no-intervention:${input.activePlan?.id ?? "no-plan"}:${effectiveFallRisk}`,
        kind: "fall_risk_without_intervention",
        severity: "high",
        title: "Fall risk documented with no fall intervention in the plan",
        source: assessedFallRisk
          ? reviewRef()
          : { label: "Care header", at: null, href: `${input.residentHref}?tab=overview` },
        conflicting: input.activePlan
          ? {
            label: `Support plan v${input.activePlan.version_number}`,
            at: input.activePlan.effective_date,
            href: `${input.residentHref}?tab=support-plan`,
          }
          : { label: "No support plan in force", at: null, href: `${input.residentHref}?tab=support-plan` },
        recommendedResolution:
          "Add a fall-prevention intervention to the plan, or record why none is indicated at this risk level.",
        responsibleRole: "Administrator",
      });
    }
  }

  // 5. The resident returned from hospital with recorded changes, but the plan predates the return.
  if (input.hospitalReturn?.returnedAt && input.hospitalReturn.recordedChanges && input.activePlan) {
    // Calendar dates, not instants. `effective_date` is a DATE column with no time in it, so
    // `new Date("2026-07-26")` yields UTC midnight -- which sorts before a same-day return recorded
    // at any local time after 00:00Z. West of Greenwich that flagged plans written IN RESPONSE to
    // the return as predating it, and the direction of the error changed with the deployment's
    // offset. A plan effective on a given day covers that whole day, so it predates the return only
    // when its date is strictly earlier than the return's local calendar date.
    const planDay = input.activePlan.effective_date?.slice(0, 10) ?? null;
    const returnDay = localCalendarDay(input.hospitalReturn.returnedAt);
    if (planDay && returnDay && planDay < returnDay) {
      const age = daysBetween(input.hospitalReturn.returnedAt, now);
      conflicts.push({
        key: `plan-predates-return:${input.hospitalReturn.episodeId}:${input.activePlan.id}`,
        kind: "plan_predates_hospital_return",
        severity: "high",
        title: "Support plan predates a hospital return that recorded changes",
        source: {
          label: `Hospital return${age !== null ? ` ${age} day${age === 1 ? "" : "s"} ago` : ""}`,
          at: input.hospitalReturn.returnedAt,
          href: `${input.residentHref}?tab=timeline`,
        },
        conflicting: {
          label: `Support plan v${input.activePlan.version_number}`,
          at: input.activePlan.effective_date,
          href: `${input.residentHref}?tab=support-plan`,
        },
        recommendedResolution:
          "Revise the support plan against the hospital-return review, or document that the recorded changes do not affect the plan.",
        responsibleRole: "Administrator",
      });
    }
  }

  const severityRank: Record<CareConflictSeverity, number> = { high: 2, attention: 1 };
  return conflicts.sort((a, b) => {
    const bySeverity = severityRank[b.severity] - severityRank[a.severity];
    return bySeverity !== 0 ? bySeverity : (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });
}

export type ConflictDisposition = "accepted" | "corrected" | "exception_documented";

export const CONFLICT_DISPOSITION_LABELS: Record<ConflictDisposition, string> = {
  accepted: "Accept — update the record to match",
  corrected: "Correct — the source record was wrong",
  exception_documented: "Document exception — both are right, here is why",
};

/**
 * Hide conflicts whose disposition still applies. A disposition is keyed to the exact disagreement,
 * so if the underlying values change the key changes and the conflict resurfaces -- which is the
 * behaviour you want: resolving "two_person vs supervision" should not silently absolve
 * "mechanical_lift vs supervision" later.
 */
export function applyConflictDispositions(
  conflicts: CareConflict[],
  dispositions: { conflict_key: string }[],
): CareConflict[] {
  const resolved = new Set(dispositions.map((entry) => entry.conflict_key));
  return conflicts.filter((conflict) => !resolved.has(conflict.key));
}
