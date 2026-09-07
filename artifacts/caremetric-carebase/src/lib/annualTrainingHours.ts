import { addFacilityCalendarYears, facilityDateOf } from "./dateUtils";

/**
 * Annual training hours on the employee's own training year, rather than the calendar year the
 * stored bucket is keyed on (BACKLOG.md J28).
 *
 * `recalculate_compliance_core` sums earned hours into `employee_training_hour_buckets` keyed on
 * `extract(year from v_pa_today)` (20260715210000), and grades the bucket `due_soon` once 2 October
 * passes. Every requirement that bucket summarises is on a rolling clock instead: a training
 * record's due date is `completion_date + training_types.renewal_interval_days`, and the product's
 * own regulatory summary of 55 Pa. Code § 2600.65 says CareBase "tracks each staff member's annual
 * hours against their assignment date, flags shortfalls before the anniversary"
 * (20260723120000). The two disagree every January: an employee whose matrix is compliant until
 * November reads "0 of 12 hours" on the hours card from 1 January, because the calendar bucket
 * reset and their anniversary did not.
 *
 * The stored bucket is not recomputed here -- it is the frozen per-calendar-year record, and past
 * years are deliberately never rewritten. This recomputes the numerator over the employee's own
 * training year from the same evidence the server sums, so the figure shown beside an
 * anniversary-based requirement is on the same clock as the requirement. The denominator stays the
 * server's `required_hours`: choosing it involves facility type and audience-confirmation rules
 * (`pending_review` / `not_applicable`) that belong in one place, and that place is the database.
 */

/** `[start, end)` facility calendar dates covering the employee's current training year. */
export interface TrainingYearWindow {
  /** The anniversary this training year began on (inclusive). */
  start: string;
  /** The next anniversary, on which this training year ends (exclusive). */
  end: string;
}

/**
 * The training year containing `today`, counted from `anniversaryDate` (the hire date).
 *
 * Returns null when there is no anniversary to count from, or when the anniversary is in the
 * future -- a hire date after today is either a scheduled start or bad data, and inventing a
 * window for it would put a denominator against an employee who has not started.
 */
export function trainingYearWindow(
  anniversaryDate: string | null | undefined,
  today: string,
): TrainingYearWindow | null {
  if (!anniversaryDate || anniversaryDate > today) return null;
  const anniversaryYear = Number(anniversaryDate.slice(0, 4));
  const currentYear = Number(today.slice(0, 4));
  if (!Number.isFinite(anniversaryYear) || !Number.isFinite(currentYear)) return null;
  // Roll forward from the hire date rather than substituting this year's number into it:
  // addFacilityCalendarYears clamps 29 February to 28 February in non-leap years, so a leap-day
  // hire keeps a stable anniversary instead of drifting to 1 March.
  //
  // BOTH boundaries are measured from the hire date, each with its own offset. Deriving `end` from
  // the already-clamped `start` lost a day for a 29 February hire: on 2028-02-28 a 2020-02-29 hire
  // resolved to { start: 2027-02-28, end: 2028-02-28 }, and since the contract is [start, end) the
  // current day fell outside its own window while the next did not open until 2028-02-29. Hours
  // completed that day counted toward nothing. Clamping each boundary independently keeps
  // consecutive windows touching, which is what makes the half-open interval safe.
  let offset = currentYear - anniversaryYear;
  let start = addFacilityCalendarYears(anniversaryDate, offset);
  if (start > today) {
    offset -= 1;
    start = addFacilityCalendarYears(anniversaryDate, offset);
  }
  return { start, end: addFacilityCalendarYears(anniversaryDate, offset + 1) };
}

/** A completed training record, in the shape `employee_training_records` returns it. */
export interface TrainingRecordHours {
  id: string;
  training_type_id: string;
  completion_date: string | null;
  hours: number | null;
  completion_method: string | null;
  status: string | null;
  /** `employee_training_records.audience_decision_at`; null until an employer decides. */
  audience_decision_at: string | null;
  created_at: string;
}

/** The two statuses that mean "the employer has not confirmed this requirement applies". */
const UNCONFIRMED_AUDIENCE_STATUSES = new Set(["pending_review", "not_applicable"]);

/**
 * The employer's current audience decision for each training type -- the browser-side twin of
 * `public.current_training_audience_status(employee, training_type)`, which reads the status of the
 * LATEST record for that pair, ordered `audience_decision_at desc nulls last, created_at desc,
 * id desc`.
 *
 * This is the type-level half of an exclusion the module previously applied only per record. The
 * server excludes the whole TYPE from `creditable_types` when its current decision is
 * `pending_review` / `not_applicable`; skipping just the undecided record leaves any other record
 * on that type still contributing. A renewal inserts a fresh row rather than editing the old one
 * (see 20260906240000), so more than one record per (employee, type) is the normal shape, not an
 * edge case -- and an employer who marks a requirement not-applicable after hours were already
 * logged against it is exactly the case where the two readings part company.
 */
export function audienceStatusByTypeId(
  records: readonly TrainingRecordHours[],
): Map<string, string | null> {
  const latest = new Map<string, TrainingRecordHours>();
  for (const record of records) {
    const held = latest.get(record.training_type_id);
    if (!held || isMoreRecentAudienceRecord(record, held)) latest.set(record.training_type_id, record);
  }
  return new Map([...latest].map(([typeId, record]) => [typeId, record.status]));
}

/**
 * `audience_decision_at desc nulls last, created_at desc, id desc`, as a comparison.
 *
 * The two timestamps are compared as strings, which is chronological for the shape PostgREST
 * serialises a `timestamptz` in: a fixed-width date and time, a variable-length fractional part,
 * then a constant `+00:00`. Every character that can follow the seconds sorts above `+`, so a
 * value with no fractional part precedes one that has any, and longer fractions compare digit by
 * digit against shorter ones correctly.
 */
function isMoreRecentAudienceRecord(candidate: TrainingRecordHours, held: TrainingRecordHours): boolean {
  const decided = candidate.audience_decision_at;
  const heldDecided = held.audience_decision_at;
  // "nulls last" in a DESC order puts a decided record ahead of an undecided one.
  if (decided !== heldDecided) {
    if (decided === null) return false;
    if (heldDecided === null) return true;
    return decided > heldDecided;
  }
  if (candidate.created_at !== held.created_at) return candidate.created_at > held.created_at;
  return candidate.id > held.id;
}

/** An individual course completion's regulatory credit, from `course_completion_credits`. */
export interface CourseCreditHours {
  training_type_id: string;
  credit_hours: number | null;
  credited_at: string | null;
}

/** The hour-bucket membership and applicability scope of a training type, from `training_types`. */
export interface TrainingTypeBucket {
  id: string;
  hour_bucket: string | null;
  is_active: boolean;
  /** `training_types.state`, NOT NULL default 'PA'. */
  state: string;
  /** `training_types.applies_to_facility_type`, NOT NULL default 'BOTH'. */
  applies_to_facility_type: string;
  /** `training_types.audience_verification_required`, NOT NULL default false. */
  audience_verification_required: boolean;
}

/** The facility an employee is assigned to, as the applicability rule reads it. */
export interface TrainingFacilityScope {
  facilityType: string | null | undefined;
  /** `facilities.state`; the server reads a missing one as 'PA'. */
  facilityState: string | null | undefined;
}

/**
 * Whether a training type's records may earn hours for an employee at this facility.
 *
 * The server decides this in `recalculate_compliance_core`'s `applicable_types` /
 * `creditable_types` CTEs (20260715210000): a type contributes only while it `is_active`, its
 * `state` equals the facility's (a missing facility state reads as 'PA', as it does in SQL), and
 * its `applies_to_facility_type` is either 'BOTH' or the facility's own type. `get_training_matrix_page`
 * applies the same facility-type rule from the other side, rendering a type outside the employee's
 * facility type as `not_applicable` rather than `missing`.
 *
 * This existed only in SQL, and the hours card recomputed its numerator without it: every training
 * type in the tenant's reach was folded into the bucket map, so hours recorded against a deactivated
 * type, another state's type, or another facility type's type (a Home Health Aide in-service against
 * a personal care home employee) were added to the anniversary figure that the server's own bucket
 * would never count. The card then showed that inflated number FIRST, above the calendar-year row it
 * is supposed to restate -- so the two figures on one card disagreed for a reason that had nothing to
 * do with the clock the card exists to explain, and the larger one could read as compliant while the
 * record of truth said the employee was short.
 */
export function trainingTypeCreditsFacility(
  type: TrainingTypeBucket,
  { facilityType, facilityState }: TrainingFacilityScope,
): boolean {
  if (!type.is_active) return false;
  if (type.state !== (facilityState ?? "PA")) return false;
  return type.applies_to_facility_type === "BOTH" || type.applies_to_facility_type === facilityType;
}

export interface BucketHours {
  bucketType: string;
  /** Hours the bucket counts: non-OJT plus course credit plus OJT up to the bucket's cap. */
  completedHours: number;
  /** All on-the-job hours earned in the window, capped or not -- shown as the server shows it. */
  ojtHours: number;
}

/**
 * Hours a PCH general-annual bucket may draw from on-the-job training.
 *
 * 55 Pa. Code § 2600.65(f)-(g): of the 12 annual hours, no more than 6 may be on the job. No other
 * bucket admits any, which is what `recalculate_compliance_core`'s
 * `case when bucket_type = 'general_annual' and facility_type = 'PCH' then 6 else 0 end` encodes.
 */
export const PCH_GENERAL_ANNUAL_OJT_CAP = 6;

export function ojtCapForBucket(bucketType: string, facilityType: string | null | undefined): number {
  return bucketType === "general_annual" && facilityType === "PCH" ? PCH_GENERAL_ANNUAL_OJT_CAP : 0;
}

/**
 * Earned hours per bucket over a training-year window, summed the way the server sums them.
 *
 * Deliberately mirrors `recalculate_compliance_core`'s `legacy_earned` + `course_earned` CTEs,
 * including the exclusions their `creditable_types` join carries. Three of them:
 *
 *   1. A record in `pending_review` or `not_applicable` contributes nothing (`legacy_earned`'s own
 *      `r.status not in (...)`).
 *   2. Nothing on a training type outside this employee's facility contributes -- see
 *      `trainingTypeCreditsFacility`.
 *   3. On a type that asks for an audience decision, nothing contributes while that decision is
 *      `pending_review` or `not_applicable` -- whichever record carries the hours. A type that
 *      does not ask is unaffected, as `not tt.audience_verification_required` makes it in SQL.
 *      See `audienceStatusByTypeId`.
 *
 * NOT mirrored, on purpose: `applicable_types`' `distinct on (employee, bucket)`, which picks ONE
 * denominator-supplying type per bucket. That selection only narrows what earns credit where two
 * types in the same bucket BOTH survive the three exclusions above -- in the seeded catalog, only
 * the two Chapter 6400 group-home types, and only for an employer who has confirmed both the
 * direct-service-worker and the other-staff audience for the same person. The denominator this
 * numerator is shown against comes from the server's own bucket row either way, so reproducing the
 * tie-break here would add a second copy of a rule to drift rather than close a gap.
 */
export function bucketHoursInWindow({
  window,
  records,
  courseCredits,
  trainingTypes,
  facilityType,
  facilityState,
}: {
  window: TrainingYearWindow;
  records: readonly TrainingRecordHours[];
  courseCredits: readonly CourseCreditHours[];
  trainingTypes: readonly TrainingTypeBucket[];
  facilityType: string | null | undefined;
  facilityState: string | null | undefined;
}): Map<string, BucketHours> {
  const audienceByTypeId = audienceStatusByTypeId(records);
  const bucketByTypeId = new Map<string, string>();
  for (const type of trainingTypes) {
    if (!type.hour_bucket) continue;
    if (!trainingTypeCreditsFacility(type, { facilityType, facilityState })) continue;
    // Only for a type that asks for a decision. The server's guard is
    // `not tt.audience_verification_required or current_training_audience_status(...) not in (...)`,
    // so a type that never asks is credited whatever its records say -- and applying the exclusion
    // to it anyway would be a new divergence introduced by the fix for the old one.
    const audience = audienceByTypeId.get(type.id);
    if (type.audience_verification_required && audience != null
      && UNCONFIRMED_AUDIENCE_STATUSES.has(audience)) continue;
    bucketByTypeId.set(type.id, type.hour_bucket);
  }

  const nonOjt = new Map<string, number>();
  const ojt = new Map<string, number>();
  const add = (map: Map<string, number>, bucket: string, hours: number) =>
    map.set(bucket, (map.get(bucket) ?? 0) + hours);

  for (const record of records) {
    const bucket = bucketByTypeId.get(record.training_type_id);
    if (!bucket) continue;
    if (record.status === "pending_review" || record.status === "not_applicable") continue;
    if (!record.completion_date) continue;
    if (record.completion_date < window.start || record.completion_date >= window.end) continue;
    const hours = Number(record.hours ?? 0);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    add(record.completion_method === "on_the_job" ? ojt : nonOjt, bucket, hours);
  }

  for (const credit of courseCredits) {
    const bucket = bucketByTypeId.get(credit.training_type_id);
    if (!bucket || !credit.credited_at) continue;
    // `credited_at` is a timestamptz and the window is a pair of facility calendar dates, so the
    // instant has to be converted to one before it can be compared. Slicing the leading ten
    // characters -- which this did, on a comment claiming they were the same thing -- takes the
    // UTC date instead: `2026-01-02T01:00:00Z` is still January 1 in Pennsylvania, so a course
    // credited on a Pennsylvania evening at the edge of an employee's training year was counted
    // against the following one and missing from the year it was earned in.
    const creditedOn = facilityDateOf(credit.credited_at);
    if (!creditedOn || creditedOn < window.start || creditedOn >= window.end) continue;
    const hours = Number(credit.credit_hours ?? 0);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    add(nonOjt, bucket, hours);
  }

  const result = new Map<string, BucketHours>();
  for (const bucket of new Set([...nonOjt.keys(), ...ojt.keys()])) {
    const ojtRaw = ojt.get(bucket) ?? 0;
    const counted = (nonOjt.get(bucket) ?? 0) + Math.min(ojtRaw, ojtCapForBucket(bucket, facilityType));
    result.set(bucket, {
      bucketType: bucket,
      // Two decimals: training_types.required_hours and course credit_hours are numeric(6,2), so
      // anything finer is float noise rather than a recorded quantity.
      completedHours: Math.round(counted * 100) / 100,
      ojtHours: Math.round(ojtRaw * 100) / 100,
    });
  }
  return result;
}

export type BucketStanding = "compliant" | "due_soon" | "incomplete";

/**
 * How the training year is going, on the same three-way split the stored bucket uses.
 *
 * The warning window is 90 days before the anniversary, matching the server's own
 * "90 days before 31 December" -- the same lead time, moved onto the clock the requirement runs on.
 */
export const TRAINING_YEAR_WARNING_DAYS = 90;

export function bucketStanding(
  completedHours: number,
  requiredHours: number,
  window: TrainingYearWindow,
  today: string,
): BucketStanding {
  if (requiredHours > 0 && completedHours >= requiredHours) return "compliant";
  const daysRemaining = Math.round(
    (Date.parse(`${window.end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return daysRemaining <= TRAINING_YEAR_WARNING_DAYS ? "due_soon" : "incomplete";
}

/**
 * Display names for the three `training_types.hour_bucket` codes
 * (`general_annual` / `alr_dementia` / `sdcu_dementia`, 20260705140921).
 *
 * Spelled out rather than derived by humanising the code: `alr_dementia` would humanise to
 * "Alr Dementia", and the stored `ALR` code is never the customer-facing term -- this product calls
 * that facility type an Assisted Living Facility (ALF). See lib/facilityTypes.ts, which holds the
 * canonical label the ALF entry here matches.
 */
export const HOUR_BUCKET_LABELS: Record<string, string> = {
  general_annual: "General annual hours",
  alr_dementia: "Assisted Living Facility (ALF) dementia hours",
  sdcu_dementia: "Secured dementia care unit hours",
};

export function hourBucketLabel(bucketType: string): string {
  return HOUR_BUCKET_LABELS[bucketType] ?? bucketType.replace(/_/g, " ");
}
