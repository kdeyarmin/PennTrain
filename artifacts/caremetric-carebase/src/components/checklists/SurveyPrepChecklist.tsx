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

  const steps: JobChecklistStep[] = [
    {
      id: "readiness",
      label: "Clear readiness gaps",
      detail: readinessScore === null
        ? "Review citation-weighted readiness for this facility."
        : `Current score ${readinessScore}%. Work top gaps before survey week.`,
      status: readinessOk ? "complete" : "current",
      href: `/app/inspection-readiness${facilityQ}`,
      cta: "Open readiness",
    },
    {
      id: "binder",
      label: "Generate facility binder",
      detail: hasBinder
        ? "A completed binder export is on file."
        : "Export a single-facility compliance binder (async job).",
      status: hasBinder ? "complete" : readinessOk ? "current" : "upcoming",
      href: "/app/compliance-binder",
      cta: "Open binder",
    },
    {
      id: "evidence",
      label: "Publish documentation room",
      detail: hasEvidenceCollection
        ? "A published evidence collection is ready for guest access controls."
        : "Prepare an evidence collection surveyors can be granted into.",
      status: hasEvidenceCollection ? "complete" : hasBinder ? "current" : "upcoming",
      href: "/app/evidence",
      cta: "Open evidence",
    },
    {
      id: "survey-day",
      label: surveyDayActive ? "Survey Day is active" : "Start Survey Day",
      detail: surveyDayActive
        ? "Resume the live workspace: entrance checklist, binder, staff roster."
        : "When the surveyor arrives — one confirm after facility is selected.",
      status: surveyDayActive ? "complete" : hasEvidenceCollection || hasBinder ? "current" : "upcoming",
      href: `/app/survey-day${facilityQ}`,
      cta: surveyDayActive ? "Resume" : "Start Survey Day",
    },
  ];

  return (
    <JobChecklist
      title="Survey readiness path"
      description="One path for survey week: inspection readiness → binder → documentation room → Survey Day. Advanced tools stay under Advanced in the nav."
      icon={ClipboardCheck}
      steps={steps}
    />
  );
}
