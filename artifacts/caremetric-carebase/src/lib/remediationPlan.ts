import type { InspectionReadinessAction } from "./inspectionReadiness";

export interface RemediationPlanStep {
  title: string;
  owner: string;
  dueInDays: number;
  evidence: string;
}

export interface RemediationPlanDraft {
  title: string;
  summary: string;
  steps: RemediationPlanStep[];
  reviewerNote: string;
}

function ownerFor(action: InspectionReadinessAction): string {
  if (action.kind === "citation_topic") return "Compliance lead";
  if (action.title.toLowerCase().includes("administrator")) return "Administrator";
  if (action.title.toLowerCase().includes("roster") || action.title.toLowerCase().includes("staff")) return "HR / staffing owner";
  return "Facility manager";
}

function dueDaysFor(action: InspectionReadinessAction): number {
  if (action.severity === "critical") return 3;
  if (action.severity === "high") return 7;
  return 14;
}

function evidenceFor(action: InspectionReadinessAction): string {
  if (action.kind === "citation_topic") return "Updated compliance record, supporting document, or corrective action linked to the citation topic.";
  return "Entrance-conference checklist item marked ready with supporting documentation attached or documented.";
}

export function buildRemediationPlanDraft(actions: InspectionReadinessAction[]): RemediationPlanDraft {
  const prioritized = actions.slice(0, 5);
  return {
    title: "Inspection Readiness Remediation Plan",
    summary: prioritized.length === 0
      ? "No priority gaps were found. Keep monitoring the readiness score and regenerate the packet before inspection."
      : `Address ${prioritized.length} prioritized readiness gap${prioritized.length === 1 ? "" : "s"} before generating the entrance conference packet.`,
    steps: prioritized.map((action) => ({
      title: action.title,
      owner: ownerFor(action),
      dueInDays: dueDaysFor(action),
      evidence: evidenceFor(action),
    })),
    reviewerNote: "Human review required: confirm owners, due dates, and documentation before assigning this plan.",
  };
}

export function remediationPlanToText(plan: RemediationPlanDraft): string {
  const steps = plan.steps.length === 0
    ? "- No open remediation steps."
    : plan.steps.map((step, index) => [
        `${index + 1}. ${step.title}`,
        `   Owner: ${step.owner}`,
        `   Due: ${step.dueInDays} day${step.dueInDays === 1 ? "" : "s"}`,
        `   Documentation: ${step.evidence}`,
      ].join("\n")).join("\n");

  return [plan.title, "", plan.summary, "", steps, "", plan.reviewerNote].join("\n");
}
