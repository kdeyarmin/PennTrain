import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ShieldCheck,
  GraduationCap,
  FileCheck,
  ClipboardCheck,
  BellRing,
  FileStack,
  Users,
  UploadCloud,
  Building2,
  HeartHandshake,
  HomeIcon,
  Stethoscope,
  CheckCircle2,
  ArrowRight,
  Mail,
} from "lucide-react";

const SETTINGS = [
  {
    icon: Building2,
    title: "Personal Care Homes",
    description:
      "Track medication administration training, annual practicums, and staff certifications across every facility.",
  },
  {
    icon: HeartHandshake,
    title: "Nursing Homes & Assisted Living",
    description:
      "Keep licensed and unlicensed staff current on required in-services, competencies, and renewal deadlines.",
  },
  {
    icon: HomeIcon,
    title: "Home Health Agencies",
    description:
      "Manage field staff training records and documents across a distributed, mobile workforce.",
  },
  {
    icon: Stethoscope,
    title: "Hospice Agencies",
    description:
      "Stay survey-ready with audit-friendly records for every discipline on your interdisciplinary team.",
  },
];

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Compliance Tracking",
    description:
      "Training records, certifications, and medication practicums in one system of record, with automatic alerts before anything lapses.",
  },
  {
    icon: GraduationCap,
    title: "Built-in LMS",
    description:
      "Author courses, quizzes with server-side grading, and issue certificates -- no separate training vendor required.",
  },
  {
    icon: ClipboardCheck,
    title: "Competency Checklists",
    description:
      "Configurable competency templates and training plans so every role gets the right requirements, automatically.",
  },
  {
    icon: FileStack,
    title: "One-Click Compliance Binder",
    description:
      "Generate a real, survey-ready compliance binder PDF for any facility in seconds -- no more print-to-PDF workarounds.",
  },
  {
    icon: BellRing,
    title: "Alerts & Retraining Reminders",
    description:
      "Get ahead of expiring certifications and overdue retraining before a surveyor finds them first.",
  },
  {
    icon: FileCheck,
    title: "Public Certificate Verification",
    description:
      "Every certificate ships with a public, tamper-evident verification link for surveyors and employers.",
  },
  {
    icon: Users,
    title: "Role-Based Access",
    description:
      "Six built-in roles -- from platform admin down to employee -- enforced at the database layer, not just the UI.",
  },
  {
    icon: UploadCloud,
    title: "Bulk Employee Import",
    description:
      "Onboard an entire facility roster in minutes with CSV import instead of one-by-one data entry.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Set up your organization",
    description:
      "Add your facilities, import your employee roster, and configure the training types your state requires.",
  },
  {
    step: "02",
    title: "Assign training & practicums",
    description:
      "Build training plans and course assignments once, and let CareMetric Train track completion for every employee.",
  },
  {
    step: "03",
    title: "Stay audit-ready",
    description:
      "Alerts flag what's expiring, reports show where you stand, and the compliance binder is always one click away.",
  },
];

function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <div
      className={`${className} rounded-xl bg-gradient-to-br from-primary to-[#0f3f92] flex items-center justify-center shadow-sm shrink-0`}
    >
      <ShieldCheck className="h-[55%] w-[55%] text-primary-foreground" />
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <div className="flex flex-col leading-none">
              <span className="whitespace-nowrap text-[15px] font-bold tracking-tight">
                CareMetric Train
              </span>
              <span className="hidden whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:block">
                Compliance Training &amp; LMS
              </span>
            </div>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Features
            </a>
            <a href="#who-its-for" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Who It's For
            </a>
            <a href="#how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              How It Works
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm" data-testid="link-login">
                Log In
              </Button>
            </Link>
            <a href="#contact">
              <Button size="sm" data-testid="button-request-demo">
                Request a Demo
              </Button>
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/60" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.05] rounded-full blur-3xl -translate-y-1/3 translate-x-1/4" />

        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Built for Long-Term &amp; Post-Acute Care
              </div>
              <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl lg:text-[52px] lg:leading-[1.05]">
                Compliance training that keeps your facility{" "}
                <span className="text-primary">audit-ready</span>, every day.
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                CareMetric Train is the compliance-training platform and LMS built for
                personal care homes, nursing homes, home health, and hospice agencies --
                replacing spreadsheets and paper binders with one system of record for
                training, certifications, and practicums.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="#contact">
                  <Button size="lg" className="gap-2" data-testid="button-hero-demo">
                    Request a Demo
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </a>
                <Link href="/login">
                  <Button size="lg" variant="outline" data-testid="button-hero-login">
                    Log In
                  </Button>
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-primary" /> Role-based access
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-primary" /> Audit-ready reporting
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-primary" /> Built on Supabase security
                </span>
              </div>
            </div>

            {/* Product preview mock */}
            <div className="relative">
              <Card className="border-border/60 shadow-2xl shadow-black/[0.06]">
                <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border/60 pb-4">
                  <div className="flex items-center gap-2">
                    <LogoMark className="h-7 w-7" />
                    <CardTitle className="text-sm">Sunrise Healthcare Group</CardTitle>
                  </div>
                  <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                    98% Compliant
                  </span>
                </CardHeader>
                <CardContent className="space-y-3 pt-5 pb-10">
                  {[
                    { label: "Medication Administration", value: 100 },
                    { label: "Annual In-Service", value: 92 },
                    { label: "Competency Checklists", value: 88 },
                    { label: "Retraining Due (14 days)", value: 34 },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="mb-1.5 flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground/80">{row.label}</span>
                        <span className="text-muted-foreground">{row.value}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${row.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <div className="absolute -bottom-5 -left-5 hidden rounded-xl border border-border/60 bg-card px-4 py-3 shadow-xl sm:block">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <FileStack className="h-4 w-4 text-primary" />
                  Compliance Binder generated
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Maple Grove Senior Living -- 2.3s
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who-its-for" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Built for every care setting
          </h2>
          <p className="mt-4 text-muted-foreground">
            One multi-tenant platform, configured for the training and documentation
            rules your organization actually has to follow.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SETTINGS.map((setting) => (
            <Card key={setting.title} className="border-border/60">
              <CardHeader>
                <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                  <setting.icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-base">{setting.title}</CardTitle>
                <CardDescription>{setting.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything compliance requires. Nothing it doesn't.
            </h2>
            <p className="mt-4 text-muted-foreground">
              From day-one onboarding to survey day, CareMetric Train covers the full
              lifecycle of staff training and documentation.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-xl border border-border/60 bg-card p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Up and running in three steps
          </h2>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.step} className="relative">
              <div className="text-5xl font-bold text-primary/15">{step.step}</div>
              <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
              {i < STEPS.length - 1 && (
                <ArrowRight className="absolute right-0 top-2 hidden h-5 w-5 text-muted-foreground/40 lg:-right-6 lg:block" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* CTA banner */}
      <section
        id="contact"
        className="relative overflow-hidden bg-gradient-to-br from-[#102a43] via-[#1e3a5f] to-[#243b53] text-white"
      >
        <div className="absolute inset-0 opacity-20 [background:radial-gradient(circle_at_top_right,white,transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to make compliance simple?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/70">
            Tell us about your organization and we'll set up a walkthrough of
            CareMetric Train for your team.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href="mailto:hello@caremetric.ai?subject=CareMetric%20Train%20Demo%20Request">
              <Button size="lg" variant="secondary" className="gap-2" data-testid="button-cta-email">
                <Mail className="h-4 w-4" />
                hello@caremetric.ai
              </Button>
            </a>
            <Link href="/login">
              <Button
                size="lg"
                variant="outline"
                className="border-white/30 bg-transparent text-white hover:bg-white/10"
                data-testid="button-cta-login"
              >
                Log In
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div className="max-w-sm">
              <div className="flex items-center gap-2.5">
                <LogoMark className="h-8 w-8" />
                <span className="text-sm font-bold">CareMetric Train</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Compliance training and LMS for personal care homes, nursing homes,
                home health, and hospice agencies.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Product
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  <li><a href="#features" className="text-muted-foreground hover:text-foreground">Features</a></li>
                  <li><a href="#who-its-for" className="text-muted-foreground hover:text-foreground">Who It's For</a></li>
                  <li><a href="#how-it-works" className="text-muted-foreground hover:text-foreground">How It Works</a></li>
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Account
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  <li><Link href="/login" className="text-muted-foreground hover:text-foreground">Log In</Link></li>
                  <li><a href="#contact" className="text-muted-foreground hover:text-foreground">Request a Demo</a></li>
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  The CareMetric Family
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  <li>
                    <a href="https://caremetric.ai" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                      CareMetric AI
                    </a>
                  </li>
                  <li>
                    <a href="https://cmbreathe.com" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                      CareMetric Breathe
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-10 border-t border-border/60 pt-6 text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} CareMetric Train. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
