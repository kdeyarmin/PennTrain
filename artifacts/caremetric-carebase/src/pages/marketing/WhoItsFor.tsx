import { ArrowRight, CheckCircle2, FilePenLine, Handshake } from "lucide-react";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import { SETTINGS } from "@/components/marketing/content";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

const BUYING_COMMITTEE_OUTCOMES = [
  "Owners and executives get an organization-wide compliance story instead of disconnected facility updates.",
  "Administrators and managers get the next actions that reduce survey risk this week.",
  "Trainers and employees get simple workflows that create clean evidence without extra paperwork.",
];

const ROLE_WORKSPACES = [
  {
    role: "Owner or executive",
    needs: "Which facilities and domains carry the most operational risk?",
    action: "Review organization rollups, trends, exceptions, and unresolved work.",
    proof: "Facility comparisons, readiness reports, and organization-level evidence exports.",
  },
  {
    role: "Administrator",
    needs: "What must be staffed, renewed, reassessed, reviewed, or closed next?",
    action: "Prioritize facility work queues, approvals, schedules, resident deadlines, and survey preparation.",
    proof: "A facility record showing ownership, completion, verification, and missing evidence.",
  },
  {
    role: "Manager",
    needs: "Which people and tasks need intervention during this shift or week?",
    action: "Resolve gaps, assign follow-up, validate outside records, and confirm closure.",
    proof: "Manager reviews, approvals, observations, corrective actions, and timestamps.",
  },
  {
    role: "Trainer",
    needs: "Who needs which learning or competency, and how will it be documented?",
    action: "Run classes, record attendance, validate outside learning, and manage practicum evidence.",
    proof: "Sign-ins, certificates, competencies, annual-hour allocation, and completion history.",
  },
  {
    role: "Employee",
    needs: "What is assigned to me, when is it due, and what remains incomplete?",
    action: "Complete learning, upload records, sign policies, and review personal requirements.",
    proof: "A self-service training and qualification record without access to coworker data.",
  },
  {
    role: "Auditor or survey reviewer",
    needs: "Can the organization show the requested evidence without exposing unrelated records?",
    action: "Review read-only, scoped evidence supplied by the facility.",
    proof: "A binder or controlled evidence room tied to the requested scope and period.",
  },
] as const;

const RESIDENT_CARE_POINTS = [
  "Preadmission screening, initial assessment (15 days after admission for PCH; normally 30 days before admission for ALF), annual reassessment, and significant-change reassessment, each on its own due date.",
  "A digital drafting tool mirroring the DHS assessment structure, with autosave, finalize-and-lock, and one-click reference PDF generation — the signed DHS-prescribed form is still what's required on file.",
  "Automatic support-plan follow-ups whenever a reassessment is completed.",
];

const OPERATING_MODES = [
  "Single facility teams that need one clean operational record for staff, residents, documents, and survey evidence.",
  "Multi-site operators that need rollups without giving every manager global access.",
  "Organizations preparing for audits, licensing surveys, recertification, or ownership transitions.",
];

const PCH_ALF_OPERATIONS = [
  "Workforce training, competencies, credentials, background and exclusion screening, medication practicums, policy attestations, and shift scheduling.",
  "Admissions and census, resident assessments and state-form workflow, services, change-of-condition follow-up, dietary rounds, appointments, transportation, and resident financial operations.",
  "Incidents, complaints, resident rights, inspections, fire drills, emergency operations, maintenance work orders, plans of correction, and quality-improvement (QAPI) projects.",
  "Alerts, work queues, approvals, regulatory crosswalks, reports, controlled evidence rooms, audit history, and facility or organization binder exports.",
];

export default function WhoItsFor() {
  usePageMeta({ ...MARKETING_ROUTE_META["/who-its-for"], path: "/who-its-for" });
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="Built around the operator"
        title="Built first for Pennsylvania personal care homes and assisted living facilities"
        subtitle="PCH and ALF operators get the full resident, workforce, facility, quality, and survey-evidence platform. Group homes, nursing homes, home health, and hospice use the training and staff-compliance pathways that apply to their setting."
        highlights={[
          "Single-site and multi-site operations",
          "Separate views for every role",
          "PCH and ALF regulatory workflows",
        ]}
      />

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-primary shadow-sm">
              <Handshake className="h-3.5 w-3.5" />
              Clear value for each stakeholder
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
              One operating record for the whole buying committee
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              CareMetric CareBase ties facility types to operational outcomes, so
              buyers can see how the platform helps leadership, administrators,
              managers, trainers, employees, and auditors at the same time.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {BUYING_COMMITTEE_OUTCOMES.map((outcome) => (
              <div
                key={outcome}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm text-foreground/85">{outcome}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-extrabold tracking-tight">
              Each role sees the decision it needs to make
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              A connected platform should not force every user through the same
              dashboard. CareBase narrows the work, permissions, and evidence to
              the person's responsibility.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {ROLE_WORKSPACES.map((workspace, index) => (
              <Reveal key={workspace.role} delay={(index % 3) * 0.05}>
                <Card className="h-full border-border/60 shadow-sm">
                  <CardHeader>
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                      Role-specific workspace
                    </p>
                    <CardTitle className="text-base">{workspace.role}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-0 text-sm leading-6">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Needs to know
                      </p>
                      <p className="mt-1 text-foreground/85">{workspace.needs}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Acts in CareBase
                      </p>
                      <p className="mt-1 text-foreground/85">{workspace.action}</p>
                    </div>
                    <div className="rounded-xl bg-primary/[0.045] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                        Evidence or handoff
                      </p>
                      <p className="mt-1 text-muted-foreground">{workspace.proof}</p>
                    </div>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight">
              CareMetric CareBase adapts to your operating model
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Whether you run one residence or a network of facilities, the app
              keeps each employee's requirements tied to the right role,
              facility type, documentation standard, and renewal window.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {OPERATING_MODES.map((mode) => (
              <div
                key={mode}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm text-foreground/85">{mode}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-extrabold tracking-tight">
            Full PCH and ALF operations, with training pathways for adjacent providers
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            The provider setting matters. CareBase exposes PCH and ALF resident and
            facility modules only where they apply, while keeping workforce training
            and qualification rules available for the other supported settings below.
          </p>
        </Reveal>

        <div className="mx-auto mt-8 grid max-w-5xl gap-3 sm:grid-cols-2">
          {PCH_ALF_OPERATIONS.map((item) => (
            <Reveal key={item}>
              <div className="flex h-full items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm leading-6 text-foreground/85">{item}</span>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SETTINGS.map((setting, i) => (
            <Reveal key={setting.title} delay={(i % 3) * 0.06}>
              <Card className="group h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                <CardHeader>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-8 ring-primary/[0.03]">
                    <setting.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{setting.title}</CardTitle>
                  <CardDescription className="leading-6">
                    {setting.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-primary shadow-sm">
              <FilePenLine className="h-3.5 w-3.5" />
              PCH &amp; ALF only
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
              Personal care homes and assisted living facilities also get
              resident-level compliance
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Beyond staff requirements, CareMetric CareBase tracks the resident-side
              regulatory deadlines Chapter 2600 and Chapter 2800 require —
              Resident Assessment and Support Plan (RASP/ASP) assessments — as
              their own compliance domain, not employee records mislabeled as
              resident data.
            </p>
            <Link
              href="/features#resident-care"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              See resident care compliance features
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {RESIDENT_CARE_POINTS.map((point) => (
              <div
                key={point}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm text-foreground/85">{point}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight">
              One product, separate views for each audience
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Executives get rollups, managers get facility-level action lists,
              trainers get class workflows, employees get self-service
              assignments, and auditors get read-only evidence.
            </p>
            <Link
              href="/features"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Explore the feature set
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
