import { ClipboardCheck } from "lucide-react";
import { JobChecklist, type JobChecklistStep } from "@/components/checklists/JobChecklist";

/**
 * One survey path: readiness → binder → evidence room → Survey Day.
 * Composes existing surfaces; does not invent a second binder or evidence system.
 */
export function SurveyPrepChecklist({
  facilityId,
  readinessScore,
  hasBinder,
  hasEvidenceCollection,
  surveyDayActive,
}: {
  facilityId: string;
  readinessScore: number | null;
  hasBinder: boolean;
  hasEvidenceCollection: boolean;
  surveyDayActive?: boolean;
}) {
  const facilityQ = facilityId ? `?facility=${facilityId}` : "";
  const readinessOk = readinessScore !== null && readinessScore >= 85;

  // Each step declares only whether IT is done; the pipeline below decides which one is current.
  // Deriving the two together per-step is what produced up to three simultaneously-"current" steps
  // here -- with `hasBinder` true and readiness still short, "Clear readiness gaps", "Publish
  // documentation room" and "Start Survey Day" all highlighted at once, each rendering a primary
  // button, in a card whose whole purpose is to name the one next thing to do.
  //
  // Survey Day is deliberately never "done": it is the live workspace, not a box that gets ticked,
  // and JobChecklist (correctly) renders no action on a completed step -- so marking it complete
  // while it is ACTIVE is exactly the state in which its `cta: "Resume"` could never be clicked.
  // Leaving it as the current step is what puts the Resume button back on screen.
  const stepDefs: (Omit<JobChecklistStep, "status"> & { done: boolean })[] = [
    {
      id: "readiness",
      label: "Clear readiness gaps",
      detail: readinessScore === null
        ? "Review citation-weighted readiness for this facility."
        : `Current score ${readinessScore}%. Work top gaps before survey week.`,
      done: readinessOk,
      href: `/app/inspection-readiness${facilityQ}`,
      cta: "Open readiness",
    },
    {
      id: "binder",
      label: "Generate facility binder",
      detail: hasBinder
        ? "A completed binder export is on file."
        : "Export a single-facility compliance binder (async job).",
      done: hasBinder,
      href: "/app/compliance-binder",
      cta: "Open binder",
    },
    {
      id: "evidence",
      label: "Publish documentation room",
      detail: hasEvidenceCollection
        ? "A published evidence collection is ready for guest access controls."
        : "Prepare an evidence collection surveyors can be granted into.",
      done: hasEvidenceCollection,
      href: "/app/evidence",
      cta: "Open evidence",
    },
    {
      id: "survey-day",
      label: surveyDayActive ? "Survey Day is active" : "Start Survey Day",
      detail: surveyDayActive
        ? "Resume the live workspace: entrance checklist, binder, staff roster."
        : "When the surveyor arrives — one confirm after facility is selected.",
      done: false,
      href: `/app/survey-day${facilityQ}`,
      cta: surveyDayActive ? "Resume" : "Start Survey Day",
    },
  ];

  // First not-done step is the current one; everything after it is upcoming. Same shape the
  // onboarding checklist on EmployeeDetail already uses, so the two read identically.
  let sawCurrent = false;
  const steps: JobChecklistStep[] = stepDefs.map(({ done, ...step }) => {
    if (done) return { ...step, status: "complete" };
    if (sawCurrent) return { ...step, status: "upcoming" };
    sawCurrent = true;
    return { ...step, status: "current" };
  });

  return (
    <JobChecklist
      title="Survey readiness path"
      description="One path for survey week: inspection readiness → binder → documentation room → Survey Day. Advanced tools stay under Advanced in the nav."
      icon={ClipboardCheck}
      steps={steps}
    />
  );
}
