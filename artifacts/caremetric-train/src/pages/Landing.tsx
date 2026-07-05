import { Link } from "wouter";
import {
  ArrowRight,
  BellRing,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  FileCheck2,
  FileStack,
  GraduationCap,
  HelpCircle,
  Layers3,
  ListChecks,
  Lock,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { LogoMark } from "@/components/brand/Logo";
import { OLD_WAY, NEW_WAY } from "@/components/marketing/content";

const HIGHLIGHTS: { href: string; icon: LucideIcon; title: string; blurb: string }[] = [
  {
    href: "/features",
    icon: GraduationCap,
    title: "Train staff online, in person, or from outside records",
    blurb:
      "Courses, quizzes, certificates, live classes, uploads, and annual requirements all reconcile to one employee training record.",
  },
  {
    href: "/who-its-for",
    icon: Building2,
    title: "Configured for care providers",
    blurb:
      "Personal care, assisted living, group homes, nursing homes, home health, and hospice each get rules matched to their setting.",
  },
  {
    href: "/security",
    icon: Lock,
    title: "Protected by role and facility",
    blurb:
      "Admins, managers, trainers, employees, and auditors see the exact records they should -- enforced by database policies.",
  },
  {
    href: "/how-it-works",
    icon: ListChecks,
    title: "From roster to survey binder",
    blurb:
      "Import staff, assign role-based plans, track progress, and generate a survey-ready binder without assembling PDFs by hand.",
  },
];

const APP_FLOW = [
  { icon: UploadCloud, label: "Import roster", detail: "Bulk-add employees and facilities" },
  { icon: Layers3, label: "Assign plans", detail: "Map training to role and license type" },
  { icon: BookOpenCheck, label: "Deliver training", detail: "Online courses, live classes, outside records" },
  { icon: BellRing, label: "Watch deadlines", detail: "Alerts before certificates or hours lapse" },
  { icon: FileStack, label: "Export proof", detail: "Binder, certificates, documents, audit trail" },
];

const ROLE_VIEWS = [
  "Org admins see compliance across every facility.",
  "Facility managers focus on assigned sites and overdue staff.",
  "Trainers schedule classes, capture sign-in, and monitor retraining.",
  "Employees complete courses, quizzes, certificates, and uploads in self-service.",
  "Auditors get read-only evidence without changing records.",
];

const PROOF_POINTS = [
  { value: "6", label: "care settings supported" },
  { value: "1", label: "record per employee" },
  { value: "24/7", label: "survey readiness" },
];

const DASHBOARD_ROWS = [
  { label: "Annual in-service hours", value: 92, status: "On track" },
  { label: "Medication practicums", value: 88, status: "12 due" },
  { label: "Expiring credentials", value: 74, status: "Review" },
  { label: "Completed course assignments", value: 96, status: "Strong" },
];

export default function Landing() {
  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="absolute left-1/2 top-0 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#59b2ff]/15 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[420px] w-[420px] translate-x-1/4 translate-y-1/3 rounded-full bg-orange-400/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-700">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-[#b9e4ff] shadow-sm backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                Compliance training, evidence, and survey prep in one place
              </div>
              <h1 className="mt-6 text-balance text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-[58px] lg:leading-[1.02]">
                Know who is trained, what is due, and where the proof lives.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-white/74">
                CareMetric Train is an LMS and compliance command center for care
                providers. It turns required in-services, credentials, practicums,
                live classes, documents, quizzes, and certificates into a single
                survey-ready record for every employee and facility.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="#contact">
                  <Button size="lg" className="gap-2 shadow-lg shadow-blue-950/30" data-testid="button-hero-demo">
                    Request a Demo
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </a>
                <Link href="/features">
                  <Button
                    size="lg"
                    variant="outline"
                    className="gap-2 border-white/25 bg-white/5 text-white hover:bg-white/12"
                    data-testid="button-hero-tour"
                  >
                    <PlayCircle className="h-4 w-4" />
                    See what it does
                  </Button>
                </Link>
              </div>
              <div className="mt-8 grid gap-3 text-sm text-white/70 sm:grid-cols-3">
                {PROOF_POINTS.map((point) => (
                  <div key={point.label} className="rounded-xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur">
                    <div className="font-mono text-xl font-bold text-white">{point.value}</div>
                    <div>{point.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:150ms] [animation-fill-mode:backwards]">
              <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-[#59b2ff]/20 to-orange-400/10 blur-2xl" />
              <Card className="relative overflow-hidden border-white/10 shadow-2xl shadow-black/30 ring-1 ring-white/10">
                <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warning/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/40" />
                  <span className="ml-2 font-mono text-[10px] tracking-wide text-muted-foreground/70">
                    CareMetric Train / Compliance Command Center
                  </span>
                </div>
                <CardHeader className="border-b border-border/60 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      <LogoMark className="h-9 w-9" />
                      <div>
                        <CardTitle className="text-base">Sunrise Healthcare Group</CardTitle>
                        <div className="font-mono text-[10px] tracking-wide text-muted-foreground/70">
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
                      ["2.3s", "binder"],
                    ].map(([value, label]) => (
                      <div key={label} className="rounded-lg border bg-muted/35 p-3">
                        <div className="font-mono text-lg font-bold text-foreground">{value}</div>
                        <div className="text-[11px] text-muted-foreground">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    {DASHBOARD_ROWS.map((row) => (
                      <div key={row.label}>
                        <div className="mb-1.5 flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground/80">{row.label}</span>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">{row.status}</span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary to-[#59b2ff]"
                            style={{ width: `${row.value}%` }}
                          />
                        </div>
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
                  Maple Grove Senior Living -- certificates, sign-ins, audits
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <Reveal className="grid gap-4 md:grid-cols-5">
            {APP_FLOW.map((step, i) => (
              <div key={step.label} className="relative rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                {i < APP_FLOW.length - 1 && <ArrowRight className="absolute -right-5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground/40 md:block" />}
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <step.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mt-3 text-sm font-semibold">{step.label}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
              </div>
            ))}
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
              Most facilities do not fail surveys because staff never learned the material.
              They struggle because proof is split across paper sign-in sheets, old PDFs,
              email attachments, and spreadsheets that only one person understands.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <Reveal>
              <Card className="h-full border-border/60">
                <CardHeader>
                  <CardTitle className="text-base text-muted-foreground">The old way</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {OLD_WAY.map((item) => (
                    <div key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
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
                  <CardTitle className="text-base text-primary">With CareMetric Train</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {NEW_WAY.map((item) => (
                    <div key={item} className="flex items-start gap-2.5 text-sm text-foreground/90">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {item}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
            What the app actually does
          </h2>
          <p className="mt-4 text-muted-foreground">
            CareMetric Train combines learning management, compliance tracking, secure
            document storage, and role-based reporting so every stakeholder works from
            the same source of truth.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {HIGHLIGHTS.map((item, i) => (
            <Reveal key={item.href} delay={(i % 2) * 0.08}>
              <Link href={item.href} className="group block h-full" data-testid={`link-highlight-${item.href.slice(1)}`}>
                <Card className="flex h-full flex-col overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                  <CardHeader>
                    <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 ring-8 ring-primary/[0.03]">
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="flex items-center justify-between text-lg">
                      {item.title}
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </CardTitle>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{item.blurb}</p>
                  </CardHeader>
                </Card>
              </Link>
            </Reveal>
          ))}
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
              Built for the people who manage, deliver, complete, and inspect training.
            </h2>
            <p className="mt-4 text-white/68">
              The app is not just a public course catalog. It is a multi-role workflow
              where each person gets the screens, actions, and evidence they need.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {ROLE_VIEWS.map((role) => (
              <div key={role} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
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
