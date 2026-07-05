import { Link } from "wouter";
import {
  ArrowRight,
  CheckCircle2,
  XCircle,
  FileStack,
  GraduationCap,
  Building2,
  Lock,
  ListChecks,
  HelpCircle,
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

/** Landing-page teasers -- each links out to its dedicated marketing page. */
const HIGHLIGHTS: { href: string; icon: LucideIcon; title: string; blurb: string }[] = [
  {
    href: "/features",
    icon: GraduationCap,
    title: "Features",
    blurb:
      "Compliance tracking, a built-in course builder, one-click compliance binders, and more -- the full toolkit.",
  },
  {
    href: "/who-its-for",
    icon: Building2,
    title: "Who It's For",
    blurb:
      "Personal care, assisted living, group homes, nursing homes, home health, and hospice -- each configured to its own rules.",
  },
  {
    href: "/security",
    icon: Lock,
    title: "Security",
    blurb:
      "Row-level security, six enforced access levels, private signed-URL storage, and an immutable audit trail.",
  },
  {
    href: "/how-it-works",
    icon: ListChecks,
    title: "How It Works",
    blurb:
      "Set up your organization, assign training and practicums, and stay survey-ready -- in three steps.",
  },
];

export default function Landing() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0a1a2e] via-[#102a43] to-[#16324f] text-white">
        <TechGrid />
        <div className="absolute top-0 right-0 h-[560px] w-[560px] -translate-y-1/3 translate-x-1/4 rounded-full bg-[#59b2ff]/[0.10] blur-3xl" />
        <div className="absolute bottom-0 left-0 h-[360px] w-[360px] translate-y-1/3 -translate-x-1/4 rounded-full bg-[#59b2ff]/[0.06] blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-700">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#8eceff]">
                <span className="whitespace-nowrap">Compliance Training Platform</span>
              </div>
              <h1 className="mt-5 text-balance text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-[52px] lg:leading-[1.05]">
                Compliance training that keeps your facility{" "}
                <span className="whitespace-nowrap text-[#59b2ff]">survey-ready</span>, every day.
              </h1>
              <p className="mt-6 max-w-xl text-lg text-white/70">
                CareMetric Train is the compliance-training platform built for
                personal care homes, assisted living, group homes, nursing homes, home
                health, and hospice agencies -- replacing spreadsheets and paper binders
                with one system of record for yearly in-services, certifications, and
                practicums.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="#contact">
                  <Button size="lg" className="gap-2" data-testid="button-hero-demo">
                    Request a Demo
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </a>
                <Link href="/login">
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/25 bg-transparent text-white hover:bg-white/10"
                    data-testid="button-hero-login"
                  >
                    Log In
                  </Button>
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#59b2ff]" /> Role-based access
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#59b2ff]" /> Survey-ready reporting
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#59b2ff]" /> Built on Supabase security
                </span>
              </div>
            </div>

            {/* Product preview mock */}
            <div className="relative animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:150ms] [animation-fill-mode:backwards]">
              <Card className="overflow-hidden border-white/10 shadow-2xl shadow-black/30 ring-1 ring-white/5">
                <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warning/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/40" />
                  <span className="ml-2 font-mono text-[10px] tracking-wide text-muted-foreground/70">
                    CareMetric Train / Dashboard
                  </span>
                </div>
                <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border/60 py-4">
                  <div className="flex items-center gap-2">
                    <LogoMark className="h-7 w-7" />
                    <div>
                      <CardTitle className="text-sm">Sunrise Healthcare Group</CardTitle>
                      <div className="font-mono text-[10px] tracking-wide text-muted-foreground/70">
                        FACILITY-0042
                      </div>
                    </div>
                  </div>
                  <span className="rounded-full bg-success/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-success">
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
                        <span className="font-mono tabular-nums text-muted-foreground">{row.value}%</span>
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
              <div className="absolute -bottom-5 -left-5 hidden rounded-xl border border-border/60 bg-card px-4 py-3 text-card-foreground shadow-xl sm:block">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <FileStack className="h-4 w-4 text-primary" />
                  Compliance Binder generated
                </div>
                <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                  Maple Grove Senior Living -- 2.3s
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              From binders and spreadsheets to one system of record
            </h2>
            <p className="mt-4 text-muted-foreground">
              Most facilities aren't failing surveys because staff aren't trained --
              they're failing because the paperwork proving it is scattered across a
              dozen places.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <Reveal>
              <Card className="h-full border-border/60">
                <CardHeader>
                  <div className="font-mono text-[10px] tracking-wide text-muted-foreground/50">FIG. A</div>
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
                  <div className="font-mono text-[10px] tracking-wide text-primary/60">FIG. B</div>
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

      {/* Highlights -- teasers linking to the dedicated pages */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
            Everything you need to stay survey-ready
          </h2>
          <p className="mt-4 text-muted-foreground">
            A quick tour of what CareMetric Train does. Dive into any area for the
            full picture.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {HIGHLIGHTS.map((item, i) => (
            <Reveal key={item.href} delay={(i % 2) * 0.08}>
              <Link href={item.href} className="group block h-full" data-testid={`link-highlight-${item.href.slice(1)}`}>
                <Card className="flex h-full flex-col border-border/60 transition-colors group-hover:border-primary/40">
                  <CardHeader>
                    <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="flex items-center justify-between text-lg">
                      {item.title}
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </CardTitle>
                    <p className="mt-1.5 text-sm text-muted-foreground">{item.blurb}</p>
                  </CardHeader>
                </Card>
              </Link>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-8 text-center">
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
