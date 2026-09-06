import { addFacilityCalendarYears } from "./dateUtils";

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
  let start = addFacilityCalendarYears(anniversaryDate, currentYear - anniversaryYear);
  if (start > today) start = addFacilityCalendarYears(start, -1);
  return { start, end: addFacilityCalendarYears(start, 1) };
}

/** A completed training record, in the shape `employee_training_records` returns it. */
export interface TrainingRecordHours {
  training_type_id: string;
  completion_date: string | null;
  hours: number | null;
  completion_method: string | null;
  status: string | null;
}

/** An individual course completion's regulatory credit, from `course_completion_credits`. */
export interface CourseCreditHours {
  training_type_id: string;
  credit_hours: number | null;
  credited_at: string | null;
}

/** The hour-bucket membership of a training type, from `training_types`. */
export interface TrainingTypeBucket {
  id: string;
  hour_bucket: string | null;
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
 * including their exclusions: a record in `pending_review` or `not_applicable` contributes nothing,
 * because the employer has not confirmed the requirement applies to this person at all.
 */
export function bucketHoursInWindow({
  window,
  records,
  courseCredits,
  trainingTypes,
  facilityType,
}: {
  window: TrainingYearWindow;
  records: readonly TrainingRecordHours[];
  courseCredits: readonly CourseCreditHours[];
  trainingTypes: readonly TrainingTypeBucket[];
  facilityType: string | null | undefined;
}): Map<string, BucketHours> {
  const bucketByTypeId = new Map<string, string>();
  for (const type of trainingTypes) {
    if (type.hour_bucket) bucketByTypeId.set(type.id, type.hour_bucket);
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
    // `credited_at` is a timestamptz; its facility calendar date is what the window is expressed
    // in, and the leading YYYY-MM-DD of the stored value is that date for the America/New_York
    // rows this table holds.
    const creditedOn = credit.credited_at.slice(0, 10);
    if (creditedOn < window.start || creditedOn >= window.end) continue;
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
