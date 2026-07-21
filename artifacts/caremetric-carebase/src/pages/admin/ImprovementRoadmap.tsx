import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Clock3, Network, Rocket, ShieldCheck, Sparkles, Wrench } from "lucide-react";

const phases = [
  {
    name: "Phase 1",
    title: "Trustworthy platform core",
    timeline: "Code complete; pilot pending",
    status: "code-complete",
    icon: ShieldCheck,
    goal: "Make existing evidence transactional, observable, testable, and recoverable.",
    outcomes: [
      "Clean-room release gate with database, role-journey, Edge, app, accessibility, and artifact validation.",
      "Append-only audit governance with integrity checks, retention, holds, manifests, and facility scope.",
      "Atomic completions/certificates, last-known-good exclusion screening, and final-outcome notifications.",
      "Shared system-job control plane with freshness, circuit, reconciliation, retry, and dead-letter evidence.",
    ],
  },
  {
    name: "Phase 2",
    title: "Enterprise domain foundation",
    timeline: "Code complete; production pilots pending",
    status: "code-complete",
    icon: Network,
    goal: "Give scope, identity, workforce, rules, commercial controls, and integrations stable contracts.",
    outcomes: [
      "Effective-dated portfolio/region hierarchy, governed permissions, and centralized scope resolution.",
      "Employee lifecycle, explainable compliance profiles, and visible backfill exception queues.",
      "Approved/versioned regulatory rules with golden fixtures, shadow evaluation, and reconciliation.",
      "Verified-domain SSO contracts, AAL2 MFA, replay-safe SCIM, and audited session revocation.",
      "Stripe-backed typed entitlements plus tenant API credentials and signed outbound webhooks.",
    ],
  },
  {
    name: "Phase 3",
    title: "Qualified-workforce operations",
    timeline: "Code complete; production pilots pending",
    status: "code-complete",
    icon: Wrench,
    goal: "Connect intake, credentials, qualifications, classes, and schedules into one authoritative workflow.",
    outcomes: [
      "Replay-safe HRIS ingestion with resumable batches, explicit duplicate decisions, and exception queues.",
      "Versioned certification evidence plus human-reviewed, malware-scanned credential renewal extraction.",
      "Qualified instructors, capacity and waitlists, signed attendance, and exactly-once completion credit.",
      "One explainable eligibility gate for assignments, open shifts, availability, and governed swaps.",
    ],
  },
  {
    name: "Phase 4",
    title: "Governed content and training",
    timeline: "Code complete; production pilots pending",
    status: "code-complete",
    icon: Sparkles,
    goal: "Make content governed, interoperable, adaptive, and safely available offline.",
    outcomes: [
      "Course/content lifecycle governance with review, approval, supersession, and retained versions.",
      "SCORM/LTI interoperability and import/export conformance evidence.",
      "Adaptive remediation, accessible media, offline sync, and conflict-safe employee progress.",
    ],
  },
  {
    name: "Phase 5",
    title: "Closed-loop compliance and evidence",
    timeline: "Code complete; production pilots pending",
    status: "code-complete",
    icon: Rocket,
    goal: "Turn findings and resident workflows into owned work, reproducible reports, and regulator-ready evidence.",
    outcomes: [
      "Owned findings, corrective actions, escalation, root cause, recurrence, and effectiveness review.",
      "Resident assessment/care-plan traceability with privacy-aware evidence boundaries.",
      "As-of reporting, evidence snapshots, external auditor access, and regulator-ready export packages.",
    ],
  },
];

const currentFoundation = [
  "Enterprise hierarchy",
  "Employee lifecycle",
  "Regulatory rule packs",
  "SSO, MFA, and SCIM",
  "Billing and entitlements",
  "Signed integrations",
  "Qualified workforce operations",
  "Governed content and training",
  "Closed-loop compliance and evidence",
];

export default function ImprovementRoadmap() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Product planning</p>
          <h1 className="text-2xl font-bold tracking-tight">Improvement Roadmap</h1>
          <p className="max-w-3xl text-muted-foreground">
            A static planning summary of the five-phase program for the 29 approved improvements from the
            product review. Phase status reflects engineering completeness, not general availability, and is
            maintained in source rather than derived from live release data. Multilingual experience remains
            explicitly excluded from this implementation program.
          </p>
        </div>
        <Badge variant="secondary" className="w-fit">29 improvements grouped into 5 phases</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current enterprise foundation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {currentFoundation.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            All five phases are code-complete behind trusted database and Edge boundaries, but none is
            general-availability promoted. GA remains blocked on controlled domain pilots, restore rehearsal,
            and an independent penetration-test exit gate.
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
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{phase.name}</Badge>
                    <Badge variant="outline" className="capitalize">{phase.status.replace(/-/g, " ")}</Badge>
                  </div>
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
