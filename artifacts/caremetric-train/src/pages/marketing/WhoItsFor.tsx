<<<<<<< HEAD
=======
import { ArrowRight, CheckCircle2, FilePenLine } from "lucide-react";
import { Link } from "wouter";
>>>>>>> origin/main
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import { SETTINGS } from "@/components/marketing/content";
<<<<<<< HEAD

export default function WhoItsFor() {
=======
import { usePageMeta } from "@/lib/usePageMeta";

const RESIDENT_CARE_POINTS = [
  "Preadmission screening, 15-day initial assessment, annual reassessment, and significant-change reassessment, each on its own due date.",
  "A state-form workflow that starts generated packets with the official PA DHS RASP/ASP pages, appends a CareMetric completion addendum, and locks each finalized version for survey records.",
  "Automatic support-plan follow-ups whenever a reassessment is completed.",
];

const OPERATING_MODES = [
  "Single facility teams that need one clean training record per employee.",
  "Multi-site operators that need rollups without giving every manager global access.",
  "Organizations preparing for audits, licensing surveys, recertification, or ownership transitions.",
];

export default function WhoItsFor() {
  usePageMeta({
    title: "Who It's For — CareMetric Train for PCH, ALF, Group Homes & More",
    description:
      "CareMetric Train adapts to personal care homes, assisted living facilities, group homes, nursing homes, home health, and hospice agencies -- each with rules matched to their setting.",
    path: "/who-its-for",
  });
>>>>>>> origin/main
  return (
    <MarketingLayout>
      <PageHero
        title="Built for every care setting"
<<<<<<< HEAD
        subtitle="One multi-tenant platform, configured for the training and documentation rules your organization actually has to follow."
      />

=======
        subtitle="One multi-tenant platform, configured for the training, competency, and documentation rules your organization actually has to follow."
      />

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight">CareMetric Train adapts to your operating model</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Whether you run one residence or a network of facilities, the app keeps
              each employee's requirements tied to the right role, facility type,
              documentation standard, and renewal window.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {OPERATING_MODES.map((mode) => (
              <div key={mode} className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm text-foreground/85">{mode}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

>>>>>>> origin/main
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SETTINGS.map((setting, i) => (
            <Reveal key={setting.title} delay={(i % 3) * 0.06}>
<<<<<<< HEAD
              <Card className="relative h-full border-border/60">
                <span className="absolute right-4 top-4 font-mono text-[10px] tracking-wide text-muted-foreground/40">
                  {setting.code}
                </span>
                <CardHeader>
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                    <setting.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{setting.title}</CardTitle>
                  <CardDescription>{setting.description}</CardDescription>
=======
              <Card className="group h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                <CardHeader>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-8 ring-primary/[0.03]">
                    <setting.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{setting.title}</CardTitle>
                  <CardDescription className="leading-6">{setting.description}</CardDescription>
>>>>>>> origin/main
                </CardHeader>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

<<<<<<< HEAD
=======
      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-primary shadow-sm">
              <FilePenLine className="h-3.5 w-3.5" />
              PCH &amp; ALF only
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
              Personal care homes and assisted living facilities also get resident-level compliance
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Beyond staff training, CareMetric Train tracks the resident-side regulatory
              deadlines Chapter 2600 and Chapter 2800 require -- RASP and ASP assessments --
              as their own compliance domain, not employee records mislabeled as resident data.
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
              <div key={point} className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
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
            <h2 className="text-2xl font-extrabold tracking-tight">One product, separate views for each audience</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Executives get rollups, managers get facility-level action lists,
              trainers get class workflows, employees get self-service assignments,
              and auditors get read-only evidence.
            </p>
            <Link href="/features" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              Explore the feature set
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

>>>>>>> origin/main
      <CtaBanner />
    </MarketingLayout>
  );
}
