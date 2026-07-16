import { lazy, Suspense } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BedDouble,
  BellRing,
  BookOpenCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  FileStack,
  FolderCheck,
  Gauge,
  GraduationCap,
  HeartHandshake,
  HelpCircle,
  Layers3,
  ListChecks,
  Lock,
  MessageSquareQuote,
  Pill,
  PlayCircle,
  ShieldCheck,
  Siren,
  Target,
  Sparkles,
  UploadCloud,
  UsersRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { LogoMark } from "@/components/brand/Logo";
import {
  FEATURE_CATEGORIES,
  OLD_WAY,
  NEW_WAY,
} from "@/components/marketing/content";
import { usePageMeta } from "@/lib/usePageMeta";

const ProductTour = lazy(() =>
  import("@/components/marketing/ProductTour").then((module) => ({
    default: module.ProductTour,
  })),
);

const HIGHLIGHTS: {
  href: string;
  icon: LucideIcon;
  title: string;
  blurb: string;
}[] = [
  {
    href: "/features",
    icon: GraduationCap,
    title: "Train staff online, in person, or from outside records",
    blurb:
      "Training modules, quizzes, certificates, live classes, AI-drafted content, and annual requirements all reconcile to one employee training record.",
  },
  {
    href: "/who-its-for",
    icon: Building2,
    title: "Built first for PCH and assisted living",
    blurb:
      "Pennsylvania personal care homes and assisted living facilities get the full operations and compliance platform; adjacent providers use matched workforce-training pathways.",
  },
  {
    href: "/security",
    icon: Lock,
    title: "Protected by role and facility",
    blurb:
      "Admins, managers, trainers, employees, and auditors see the exact records they should — enforced by database policies.",
  },
  {
    href: "/how-it-works",
    icon: ListChecks,
    title: "From roster to survey binder",
    blurb:
      "Import staff, assign role-based plans, track resident assessments and incidents, and generate a survey-ready binder without assembling PDFs by hand.",
  },
];

const BEYOND_TRAINING: { icon: LucideIcon; title: string; blurb: string }[] = [
  {
    icon: BedDouble,
    title: "Resident Assessment Compliance",
    blurb:
      "Resident Assessment and Support Plan (RASP/ASP) screening, initial assessment, and reassessments tracked with their own due dates — resident-level compliance, not just staff requirements.",
  },
  {
    icon: Gauge,
    title: "Weighted Survey Readiness",
    blurb:
      "A live per-facility score weighted toward the topic areas DHS most commonly cites — configurable planning weights, not a live citation feed — so the riskiest areas surface first.",
  },
  {
    icon: Siren,
    title: "Incidents, Violations & Fire Drills",
    blurb:
      "Reportable incidents, DHS-cited violations with a plan-of-correction workflow, and fire-drill/life-safety equipment logs, each generating its own survey-ready PDF.",
  },
  {
    icon: HeartHandshake,
    title: "Admissions, Services & Change Follow-Up",
    blurb:
      "Coordinate inquiry-to-move-in, resident services, hospital returns, change-of-condition follow-up, dietary rounds, appointments, and transportation.",
  },
  {
    icon: Pill,
    title: "Live Pass-Meds Authorization",
    blurb:
      "One roster cross-checks certification, this year's practicum, and insulin authorization into a single yes/no per employee.",
  },
  {
    icon: CalendarClock,
    title: "Shift Scheduling & Auto-Fill",
    blurb:
      "Build a staff shift schedule per facility and auto-fill it from each employee's typical pattern — managers only touch the exceptions.",
  },
];

const APP_FLOW = [
  {
    icon: UploadCloud,
    label: "Bring in the operation",
    detail: "Facilities, staff, residents, and baseline records",
  },
  {
    icon: Layers3,
    label: "Configure rules",
    detail: "Requirements, roles, deadlines, and access",
  },
  {
    icon: BookOpenCheck,
    label: "Run daily work",
    detail: "Training, services, schedules, safety, and follow-up",
  },
  {
    icon: BellRing,
    label: "Catch gaps",
    detail: "Alerts, work queues, approvals, and manager digests",
  },
  {
    icon: FileStack,
    label: "Share proof",
    detail: "Reports, binder, crosswalk, and evidence room",
  },
];

const ROLE_VIEWS = [
  "Platform admins (CareMetric support) can only step into an account with a written reason, and every session is audited.",
  "Org admins see compliance across every facility, including resident assessments where required.",
  "Facility managers focus on assigned sites, overdue staff, and shift coverage.",
  "Trainers schedule classes with QR/kiosk check-in, draft AI-assisted courses, and monitor retraining.",
  "Employees complete training, assigned resident services, operational follow-up, attestations, uploads, and shift handoffs in self-service.",
  "Auditors get read-only evidence without changing records.",
];

const BUYER_PROMISES: { icon: LucideIcon; title: string; blurb: string }[] = [
  {
    icon: Target,
    title: "Built around facility operations and inspection risk",
    blurb:
      "CareMetric CareBase connects training, resident assessments, incidents, credentials, policies, and life-safety evidence to the questions surveyors actually ask.",
  },
  {
    icon: FolderCheck,
    title: "Proof is collected as work happens",
    blurb:
      "Certificates, sign-ins, training content versions, policy signatures, documents, and audit events are attached to the right person, facility, deadline, and requirement from day one.",
  },
  {
    icon: UsersRound,
    title: "Every role gets a focused workflow",
    blurb:
      "One login, six scoped experiences — from org-wide rollups down to an employee's own assignments — so nobody wades through screens meant for someone else's job.",
  },
];

const DECISION_SIGNALS = [
  "You need more than a training portal or spreadsheet: training hours, competencies, credentials, resident compliance, incidents, inspections, schedules, policy signatures, and survey binders must agree.",
  "You operate across multiple facility types or sites and need one source of truth without overexposing sensitive records.",
  "You want managers to fix risk before an inspection instead of discovering missing evidence after a surveyor requests it.",
];

const DASHBOARD_ROWS = [
  { label: "Annual in-service hours", value: 92, status: "On track" },
  { label: "Medication practicums", value: 88, status: "12 due" },
  { label: "Expiring credentials", value: 74, status: "Review" },
  { label: "Completed staff assignments", value: 96, status: "Strong" },
];

const PLATFORM_STATS = [
  { value: "6", label: "facility types, each with its own rules" },
  { value: String(FEATURE_CATEGORIES.length), label: "feature categories across the platform" },
  { value: "60+", label: "survey-ready form templates included" },
  { value: "6", label: "roles enforced by database policy" },
];

export default function Landing() {
  usePageMeta({
    title: "CareMetric CareBase — Personal Care Home & Assisted Living Software for Pennsylvania",
    description:
      "Operations, workforce compliance, training, and survey-evidence software for Pennsylvania personal care homes and assisted living facilities under 55 Pa. Code Chapters 2600 and 2800.",
    path: "/",
  });
  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="absolute left-1/2 top-0 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#59b2ff]/15 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[420px] w-[420px] translate-x-1/4 translate-y-1/3 rounded-full bg-orange-400/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-700">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-[#b9e4ff] shadow-sm backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                PCH and assisted living operations, compliance, and evidence
              </div>
              <h1 className="mt-6 text-balance text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-[3.625rem] lg:leading-[1.02]">
                Run the facility. See the risk. Prove the work.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-white/74">
                CareMetric CareBase is an operations, workforce-compliance, and
                survey-readiness platform built first for Pennsylvania personal
                care homes and assisted living facilities. It connects every
                staff, resident, and facility requirement to the deadline it
                carries — and to the evidence a surveyor will ask for.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="gap-2 shadow-lg shadow-blue-950/30"
                  data-testid="button-hero-trial"
                >
                  <Link href="/signup">
                    Start a Free Trial
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="gap-2 border-white/25 bg-white/5 text-white hover:bg-white/12"
                  data-testid="button-hero-tour"
                >
                  <a href="#product-tour">
                    <PlayCircle className="h-4 w-4" />
                    See what it does
                  </a>
                </Button>
              </div>
              <p className="mt-4 text-sm text-white/60">
                Self-serve setup, no sales call required. Prefer a guided
                walkthrough?{" "}
                <a
                  href="#contact"
                  className="font-medium text-[#b9e4ff] hover:underline"
                >
                  Request a demo
                </a>
                .
              </p>
            </div>

            <div className="relative motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700 motion-safe:[animation-delay:150ms] motion-safe:[animation-fill-mode:backwards]">
              <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-[#59b2ff]/20 to-orange-400/10 blur-2xl" />
              <Card className="relative overflow-hidden border-white/10 shadow-2xl shadow-black/30 ring-1 ring-white/10">
                <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warning/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/40" />
                  <span className="ml-2 font-mono text-[10px] tracking-wide text-muted-foreground">
                    CareMetric CareBase / Facility Command Center
                  </span>
                </div>
                <CardHeader className="border-b border-border/60 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      <LogoMark className="h-9 w-9" />
                      <div>
                        <CardTitle className="text-base">
                          Sunrise Healthcare Group
                        </CardTitle>
                        <div className="font-mono text-[10px] tracking-wide text-muted-foreground">
                          4 facilities · 186 employees · survey binder ready
                        </div>
                      </div>
                    </div>
                    <span className="rounded-full bg-success/10 px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums text-success">
                      98% Compliant
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 pt-5 pb-6">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[
                      ["14", "items due"],
                      ["51", "certificates"],
                      ["Ready", "binder"],
                    ].map(([value, label]) => (
                      <div
                        key={label}
                        className="rounded-lg border bg-muted/35 p-3"
                      >
                        <div className="font-mono text-lg font-bold text-foreground">
                          {value}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    {DASHBOARD_ROWS.map((row) => (
                      <div key={row.label}>
                        <div className="mb-1.5 flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground/80">
                            {row.label}
                          </span>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                            {row.status}
                          </span>
                        </div>
                        <div
                          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary to-[#59b2ff]"
                            style={{ width: `${row.value}%` }}
                          />
                        </div>
                        <span className="sr-only">{row.value}% complete</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <div className="absolute -bottom-5 -left-5 hidden rounded-xl border border-border/60 bg-card px-4 py-3 text-card-foreground shadow-xl sm:block">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <FileCheck2 className="h-4 w-4 text-primary" />
                  Evidence packet generated
                </div>
                <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                  Maple Grove Senior Living — certificates, sign-ins, audits
                </div>
              </div>
            </div>
          </div>

          <Reveal className="mt-14 grid grid-cols-2 gap-6 border-t border-white/10 pt-8 sm:grid-cols-4">
            {PLATFORM_STATS.map((stat) => (
              <div key={stat.label}>
                <div className="font-mono text-2xl font-bold tabular-nums text-white">
                  {stat.value}
                </div>
                <div className="mt-1 text-xs leading-5 text-white/70">
                  {stat.label}
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <h2 className="sr-only">How CareMetric CareBase works, end to end</h2>
          <Reveal className="grid gap-4 md:grid-cols-5">
            {APP_FLOW.map((step, i) => (
              <div
                key={step.label}
                className="relative rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
              >
                {i < APP_FLOW.length - 1 && (
                  <ArrowRight className="absolute -right-5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground/40 md:block" />
                )}
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <step.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mt-3 text-sm font-semibold">{step.label}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <div id="product-tour">
        <Suspense
          fallback={
            <section
              aria-label="Loading interactive workflow tour"
              className="min-h-[36rem] border-y border-white/5 bg-[#071626]"
            />
          }
        >
          <ProductTour />
        </Suspense>
      </div>

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-primary shadow-sm">
              <MessageSquareQuote className="h-3.5 w-3.5" />
              Built for operators who cannot afford evidence gaps
            </div>
            <h2 className="mt-4 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              Make compliance visible, provable, and actionable before survey
              day.
            </h2>
            <p className="mt-4 text-muted-foreground">
              CareMetric CareBase gives operators one place to see risk, assign the
              work, capture evidence, and hand a defensible record to leadership
              or an auditor. It is not a training catalog with a dashboard bolted
              on — it is the workflow that keeps daily operations, resident
              documentation, and survey evidence aligned.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {BUYER_PROMISES.map((item, i) => (
              <Reveal key={item.title} delay={(i % 3) * 0.06}>
                <Card className="h-full border-border/60 bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                  <CardHeader>
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-8 ring-primary/[0.03]">
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                      {item.blurb}
                    </p>
                  </CardHeader>
                </Card>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-10 rounded-2xl border border-primary/20 bg-primary/[0.03] p-6">
            <h3 className="text-lg font-semibold">
              CareMetric CareBase is strongest when...
            </h3>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {DECISION_SIGNALS.map((signal) => (
                <div
                  key={signal}
                  className="flex items-start gap-3 rounded-xl bg-background/70 p-4 text-sm leading-6 text-foreground/85"
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span>{signal}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              From binders and spreadsheets to one system of record
            </h2>
            <p className="mt-4 text-muted-foreground">
              Most facilities do not fail surveys because staff never learned
              the material. They struggle because proof is split across paper
              sign-in sheets, old PDFs, email attachments, and spreadsheets that
              only one person understands.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <Reveal>
              <Card className="h-full border-border/60">
                <CardHeader>
                  <CardTitle className="text-base text-muted-foreground">
                    The old way
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {OLD_WAY.map((item) => (
                    <div
                      key={item}
                      className="flex items-start gap-2.5 text-sm text-muted-foreground"
                    >
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                      {item}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </Reveal>

            <Reveal delay={0.1}>
              <Card className="h-full border-primary/30 bg-primary/[0.03] shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base text-primary">
                    With CareMetric CareBase
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {NEW_WAY.map((item) => (
                    <div
                      key={item}
                      className="flex items-start gap-2.5 text-sm text-foreground/90"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {item}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </Reveal>
          </div>

          <Reveal className="mt-8 flex flex-col gap-4 rounded-2xl border border-primary/20 bg-background p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <CircleDollarSign className="h-4 w-4" />
                A precise replacement and savings story
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                CareBase can consolidate operational spreadsheets, binders, basic scheduling,
                training, evidence, and point tools. It works alongside your EHR, eMAR,
                payroll/timeclock, HRIS, and accounting systems rather than pretending to replace them.
              </p>
            </div>
            <Link
              href="/savings"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              See replacements and model savings
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
            What CareMetric CareBase actually does
          </h2>
          <p className="mt-4 text-muted-foreground">
            Four kinds of work live in one operational record: workforce
            training and qualification; resident admissions, services, and
            regulatory assessments; facility safety, maintenance, and emergency
            work; and the documents, quality projects, and survey evidence that
            prove all of it. Every role works from the same record.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {HIGHLIGHTS.map((item, i) => (
            <Reveal key={item.href} delay={(i % 2) * 0.08}>
              <Link
                href={item.href}
                className="group block h-full"
                data-testid={`link-highlight-${item.href.slice(1)}`}
              >
                <Card className="flex h-full flex-col overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                  <CardHeader>
                    <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 ring-8 ring-primary/[0.03]">
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="flex items-center justify-between text-lg">
                      {item.title}
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </CardTitle>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                      {item.blurb}
                    </p>
                  </CardHeader>
                </Card>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              Personal care and assisted living operations in one accountable platform
            </h2>
            <p className="mt-4 text-muted-foreground">
              CareMetric CareBase brings the non-clinical work around residents,
              staff, facilities, deadlines, safety, and evidence into the same
              system—without claiming to replace the clinical chart or eMAR.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {BEYOND_TRAINING.map((item, i) => (
              <Reveal key={item.title} delay={(i % 3) * 0.05}>
                <Card className="h-full border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                  <CardHeader>
                    <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 ring-8 ring-primary/[0.03]">
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                      {item.blurb}
                    </p>
                  </CardHeader>
                </Card>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-10 text-center">
            <Link
              href="/features"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              See the full feature list
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      <section className="bg-[#071626] text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-[#b9e4ff]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Role-aware from login to report export
            </div>
            <h2 className="mt-5 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              Built for the people who manage facilities, staff, residents, evidence,
              training, and inspections.
            </h2>
            <p className="mt-4 text-white/68">
              CareMetric CareBase is not just a training portal or content
              catalog. It is a multi-role facility workflow where each person
              gets the screens, actions, and evidence they need.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {ROLE_VIEWS.map((role) => (
              <div
                key={role}
                className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#59b2ff]" />
                <span className="text-sm text-white/82">{role}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <Reveal>
          <Link
            href="/faq"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            data-testid="link-faq"
          >
            <HelpCircle className="h-4 w-4" />
            Have questions? Read the FAQ
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </section>

      <CtaBanner id="contact" />
    </MarketingLayout>
  );
}
