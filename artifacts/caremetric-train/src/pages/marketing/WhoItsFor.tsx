import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
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

const OPERATING_MODES = [
  "Single facility teams that need one clean training record per employee.",
  "Multi-site operators that need rollups without giving every manager global access.",
  "Organizations preparing for audits, licensing surveys, recertification, or ownership transitions.",
];

export default function WhoItsFor() {
  return (
    <MarketingLayout>
      <PageHero
        title="Built for every care setting"
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

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SETTINGS.map((setting, i) => (
            <Reveal key={setting.title} delay={(i % 3) * 0.06}>
              <Card className="group h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                <CardHeader>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-8 ring-primary/[0.03]">
                    <setting.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{setting.title}</CardTitle>
                  <CardDescription className="leading-6">{setting.description}</CardDescription>
                </CardHeader>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-y border-border/60 bg-background">
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

      <CtaBanner />
    </MarketingLayout>
  );
}
