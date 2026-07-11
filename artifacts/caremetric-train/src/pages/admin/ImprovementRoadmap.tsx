import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, CircleDot, Clock3, Rocket, ShieldCheck, Sparkles, Wrench } from "lucide-react";

const phases = [
  {
    name: "Phase 0",
    title: "Trust, safety, and planning foundation",
    timeline: "1 sprint",
    icon: ShieldCheck,
    goal: "Make the current product easier to trust before broadening the feature set.",
    outcomes: [
      "Convert the 20 improvement ideas into tracked epics with owner, risk, and acceptance criteria.",
      "Define data-quality gates for training, credentials, incidents, resident records, and schedules.",
      "Document rollback and audit expectations for each new workflow before implementation starts.",
    ],
  },
  {
    name: "Phase 1",
    title: "Workflow speed and day-to-day usability",
    timeline: "2-3 sprints",
    icon: Wrench,
    goal: "Reduce clicks and turn dashboards, reports, and navigation into action surfaces.",
    outcomes: [
      "Upgrade global search toward a command palette for common create, assign, export, and support actions.",
      "Add reusable next-best-action cards to the primary admin, organization, trainer, and learner dashboards.",
      "Add saved report views, scheduled report delivery definitions, and bulk remediation flows from filtered lists.",
      "Add pinned pages and default facility preferences so large role menus stay manageable.",
    ],
  },
  {
    name: "Phase 2",
    title: "Training, competency, and attendance reliability",
    timeline: "3-5 sprints",
    icon: CheckCircle2,
    goal: "Make every training and competency outcome easier to prove during an audit.",
    outcomes: [
      "Add mobile competency observation flows with notes, signatures, attachments, and remediation outcomes.",
      "Strengthen live-class attendance reconciliation for scheduled, attended, late, absent, and paper-sign-in cases.",
      "Add schedule-to-training conflict detection so live classes do not accidentally break shift coverage.",
      "Expand offline learner and supervisor sync status for course progress, quiz attempts, signatures, and observations.",
    ],
  },
  {
    name: "Phase 3",
    title: "Inspection and compliance intelligence",
    timeline: "4-6 sprints",
    icon: CircleDot,
    goal: "Move from recordkeeping to proactive survey readiness.",
    outcomes: [
      "Create Survey Mode with entrance-conference checklists, binder generation, missing-evidence queues, and audit activity logs.",
      "Add regulatory traceability maps that connect citations to policies, courses, evidence, owners, and current status.",
      "Add resident-risk prioritization for overdue assessments, support-plan triggers, repeated incidents, and missing signed forms.",
      "Add incident trend analytics and prevention workflows that link root causes to corrective actions and retraining.",
    ],
  },
  {
    name: "Phase 4",
    title: "AI-assisted operations",
    timeline: "3-5 sprints",
    icon: Sparkles,
    goal: "Use AI to help operators understand and remediate risk without bypassing human review.",
    outcomes: [
      "Add natural-language compliance Q&A over organization records with citations back to source rows.",
      "Generate draft remediation plans for overdue training, cited violations, incident trends, and missing evidence.",
      "Generate targeted reminder copy and corrective-action drafts that require approval before sending or saving.",
      "Add regulation-update review workflows so changed requirements become reviewable tasks instead of silent drift.",
    ],
  },
  {
    name: "Phase 5",
    title: "Enterprise scale and integrations",
    timeline: "ongoing",
    icon: Rocket,
    goal: "Reduce duplicate entry and make CareMetric Train fit into larger operating environments.",
    outcomes: [
      "Add HRIS/payroll roster sync, calendar export, background-check vendor hooks, and notification provider configuration.",
      "Add webhooks for course completion, expired credentials, new incidents, schedule publication, and support events.",
      "Add coverage and overtime analytics that combine schedule assignments with compliance/credential readiness.",
      "Expand policy lifecycle management with draft, review, approve, publish, supersede, and re-attest workflows.",
    ],
  },
];

const quickWins = [
  "Command palette actions",
  "Next-best-action cards",
  "Saved report views",
  "Bulk remediation",
  "Pinned navigation",
];

export default function ImprovementRoadmap() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Product planning</p>
          <h1 className="text-2xl font-bold tracking-tight">Improvement Roadmap</h1>
          <p className="max-w-3xl text-muted-foreground">
            A phased implementation plan for the highest-value functionality improvements identified during the app review.
            Use this page to keep broad feature ideas grouped into shippable, auditable increments.
          </p>
        </div>
        <Badge variant="secondary" className="w-fit">20 suggestions grouped into 6 phases</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recommended first slice</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {quickWins.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            These items are small enough to ship first, but they also create reusable patterns for the later compliance,
            AI, and integration phases.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {phases.map((phase) => {
          const Icon = phase.icon;
          return (
            <Card key={phase.name} className="overflow-hidden">
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Badge>{phase.name}</Badge>
                  <Badge variant="outline"><Clock3 className="mr-1 h-3 w-3" />{phase.timeline}</Badge>
                </div>
                <CardTitle className="flex items-start gap-3 text-lg">
                  <span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></span>
                  <span>{phase.title}</span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{phase.goal}</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {phase.outcomes.map((outcome) => (
                    <li key={outcome} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{outcome}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
