/**
 * The twelve-step resident lifecycle journey (program plan Phase 0, item 3).
 *
 * WHY THIS FILE EXISTS. Every phase in `RESIDENT_360_PROGRAM_PLAN.md` has an exit gate that cites
 * "journey coverage", and the cross-cutting requirements say the unimplemented-step count must fall
 * each phase. Until there was a number, those gates were assertions. This registry is the number:
 * `e2e/resident-lifecycle.spec.ts` drives its browser journey from these steps, and
 * `scripts/check-journey-coverage.mjs` fails the build if the pending count goes up.
 *
 * HOW TO IMPLEMENT A STEP. Write the browser body in the spec, flip `status` to "implemented" here,
 * delete the `blockedBy` line, and lower the ceiling in `scripts/check-journey-coverage.mjs`. The
 * ratchet only turns one way on purpose.
 *
 * A STEP IS NOT "IMPLEMENTED" BECAUSE A PAGE LOADS. Each step below states what it must prove. A
 * step that navigates to a surface and asserts a heading is present proves routing, not the
 * workflow, and marking it implemented would make the coverage number worse than useless -- it
 * would make an unproven program look proven.
 */

export type JourneyStepStatus = "implemented" | "pending";

export interface JourneyStep {
  /** Stable identifier. Used by the spec's test titles, so renaming one rewrites history. */
  id: string;
  /** 1-based position in the lifecycle. */
  ordinal: number;
  title: string;
  /** What passing this step proves. Not what page it visits. */
  proves: string;
  status: JourneyStepStatus;
  /** Required when pending: the concrete reason, not "not built yet". */
  blockedBy?: string;
}

export const RESIDENT_JOURNEY_STEPS: readonly JourneyStep[] = [
  {
    id: "admit",
    ordinal: 1,
    title: "Admit a resident",
    proves: "A resident record exists with an admission date and a facility, created through the UI.",
    status: "implemented",
  },
  {
    id: "initial-assessment",
    ordinal: 2,
    title: "Complete the initial assessment",
    // The blocker named the right requirement via the wrong function: it is
    // complete_resident_compliance_item(), not finalize_resident_assessment_review(), that demands
    // the signed DHS form. The requirement itself was real, and the step satisfies it by uploading
    // a form rather than routing around it. The internal review instruments on the same tab were
    // the tempting shortcut and would have proven the wrong thing -- the UI says outright that
    // finalizing one never completes a compliance item.
    proves:
      "The initial-assessment compliance item is marked compliant only with a signed DHS form "
      + "attached, uploaded through the same flow a facility uses.",
    status: "implemented",
  },
  {
    id: "support-plan",
    ordinal: 3,
    title: "Generate a support plan from the assessment",
    proves:
      "A finalized assessment produces a support-plan proposal that waits for a human decision, and "
      + "accepting it records the rationale alongside the outcome.",
    status: "implemented",
  },
  {
    id: "deliver-services",
    ordinal: 4,
    title: "Deliver and document a service",
    proves: "A scheduled service task is completed by a floor user and the completion is attributable.",
    status: "pending",
    blockedBy:
      "Needs a seeded shift assignment for the employee account so the Floor task list is non-empty.",
  },
  {
    id: "increased-assistance",
    ordinal: 5,
    title: "Record increased assistance",
    proves: "An unscheduled service is captured outside the plan and appears against the resident.",
    status: "pending",
    blockedBy: "Depends on step 4 for a resident with an active service context.",
  },
  {
    id: "change-of-condition",
    ordinal: 6,
    title: "Review a change of condition",
    proves:
      "A rule-based change signal is raised from recorded observations and a reviewer dispositions it.",
    status: "pending",
    blockedBy:
      "The detector runs on observation history; the fixture needs a series of readings over time "
      + "rather than a single row.",
  },
  {
    id: "plan-revision",
    ordinal: 7,
    title: "Revise the support plan",
    proves: "The plan moves through its lifecycle to a new version with the prior version retained.",
    status: "implemented",
  },
  {
    id: "fall",
    ordinal: 8,
    title: "Report a fall",
    proves: "An incident is created with its pathway assigned and its notification deadlines computed.",
    status: "implemented",
  },
  {
    id: "investigation",
    ordinal: 9,
    title: "Investigate the incident",
    proves: "The eleven follow-through stages derive from evidence and closure is refused until met.",
    status: "implemented",
  },
  {
    id: "qapi",
    ordinal: 10,
    title: "Escalate a pattern into QAPI",
    proves: "A trend crossing a published threshold opens a QAPI project linked to its pattern key.",
    status: "pending",
    blockedBy:
      "Thresholds need several incidents across a date range; the fixture seeds one incident today.",
  },
  {
    id: "survey-packet",
    ordinal: 11,
    title: "Produce a survey packet",
    proves: "A Survey Day session records requests and observations and assembles them into a packet.",
    status: "implemented",
  },
  {
    id: "discharge",
    ordinal: 12,
    title: "Discharge the resident",
    // Narrowed deliberately. The original wording also claimed the held bed is released, but this
    // journey's resident is never assigned one -- bed assignment belongs to the occupancy flow, not
    // to admission. Claiming it here would make the step read as proving something it does not.
    proves: "The resident leaves active census, with a discharge date recorded alongside the status.",
    status: "implemented",
  },
] as const;

export interface JourneyCoverage {
  total: number;
  implemented: number;
  pending: number;
  /** Whole-number percent, floored. A coverage number that rounds up flatters itself. */
  percent: number;
  pendingIds: string[];
}

export function journeyCoverage(
  steps: readonly JourneyStep[] = RESIDENT_JOURNEY_STEPS,
): JourneyCoverage {
  const implemented = steps.filter((step) => step.status === "implemented");
  const pending = steps.filter((step) => step.status === "pending");
  return {
    total: steps.length,
    implemented: implemented.length,
    pending: pending.length,
    percent: steps.length === 0 ? 0 : Math.floor((implemented.length / steps.length) * 100),
    pendingIds: pending.map((step) => step.id),
  };
}
