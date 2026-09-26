import { addFacilityCalendarDays, facilityToday } from "@/lib/dateUtils";

export const SITE_REVIEW_LABELS = { bedside_device: "Bedside mobility device", voice_device: "Voice-controlled device", vehicle_documents: "Vehicle documents", driver_license: "Driver license", fire_approval: "Fire safety approval" } as const;
export type SiteReviewType = keyof typeof SITE_REVIEW_LABELS;
export type SiteReviewLike = { review_type: string; event_kind: string; occurred_at: string; next_review_on: string | null; details: unknown };
export type SiteDeadline = { label: string; due: string; completed?: string; late: boolean; timingReview?: boolean };

/** Immediate duties retain the event instant; 48 hours is elapsed time, 15 days is a PA calendar date. */
export function siteDeadlines(row: SiteReviewLike, now = new Date()): SiteDeadline[] {
  const details = row.details as Record<string, string>;
  const result: SiteDeadline[] = [];
  if (row.review_type === "fire_approval" && ["withdrawn", "restricted"].includes(row.event_kind)) {
    for (const [label, key, hours] of [["Immediate oral DHS notice", "oral_notified_at", 0], ["Written DHS notice (48 hours)", "written_notified_at", 48]] as const) {
      const due = new Date(new Date(row.occurred_at).getTime() + hours * 3_600_000).toISOString();
      const completed = details[key] || undefined;
      const afterEvent = new Date(completed ?? now).getTime() > new Date(due).getTime();
      result.push({ label, due, completed, late: afterEvent, timingReview: hours === 0 && !!completed && afterEvent });
    }
  }
  if (row.review_type === "fire_approval" && row.event_kind === "renovation") {
    const due = addFacilityCalendarDays(facilityToday(new Date(row.occurred_at)), 15);
    const completed = details.submitted_at || undefined;
    result.push({ label: "Submit new approval or authority certification", due, completed, late: facilityToday(completed ? new Date(completed) : now) > due });
  }
  if (row.next_review_on) result.push({ label: row.review_type === "vehicle_documents" || row.review_type === "driver_license" ? "Document expiration" : "Next review / renewal", due: row.next_review_on, late: facilityToday(now) > row.next_review_on });
  return result;
}

/** A rotation aid, not an invented seven-drills or one-year legal quota. */
export function drillWeekdayRotation(drills: Array<{ performed_date: string }>) {
  const counts = Array<number>(7).fill(0);
  for (const drill of drills) {
    const [year, month, day] = drill.performed_date.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (Number.isInteger(weekday)) counts[weekday]++;
  }
  const sorted = [...drills].sort((a, b) => b.performed_date.localeCompare(a.performed_date));
  const dayOf = (date: string) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  return { counts, latestRepeatedWeekday: sorted.length > 1 && dayOf(sorted[0].performed_date) === dayOf(sorted[1].performed_date) };
}

export const BEDSIDE_FIELDS = {
  need: "Assessed need", intended_use: "Intended use", risks: "Risks and mitigation", safe_use_ability: "Resident's safe-use ability", cover: "Protective cover assessment",
  installation: "Manufacturer instructions and secure installation", entrapment_measurements: "Opening measurements and entrapment assessment", independent_operation: "Independent raising and lowering", unrestricted_movement: "Unrestricted movement", review_procedure: "Periodic reassessment procedure", alf_203: "ALF §2800.203 assessment (ALF only)",
};
export const VOICE_FIELDS = { policy_notice: "Written resident policy notice / delivery", consent_privacy: "Consent and privacy safeguards", contract_terms: "Contract terms covering the device", administrators: "Authorized facility administrators", posted_notice: "Posted operating / recording notice", history_deletion: "History deletion procedure and latest deletion", disclosure_policy: "Disclosure restriction and lawful exceptions", review_procedure: "Policy review procedure" };
