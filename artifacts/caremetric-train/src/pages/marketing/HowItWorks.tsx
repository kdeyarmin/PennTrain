import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import { STEPS } from "@/components/marketing/content";

const DELIVERABLES = [
  "Employee training plans tied to role, facility, and license type",
  "Completion evidence from online courses, live classes, outside records, and practicums",
  "Dashboards, alerts, certificates, documents, audit log, and binder exports",
  "Resident assessments, incidents, inspections, and plans of correction tracked alongside staff compliance",
];

export default function HowItWorks() {
  return (
    <MarketingLayout>
      <PageHero
        title="From roster to survey binder in three connected steps"
        subtitle="Stand up your organization, assign the training your license type requires, and keep evidence current year round."
      />

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.1} className="relative">
              <Card className="h-full border-border/60 p-6 shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
              </Card>
              {i < STEPS.length - 1 && (
                <ArrowRight className="absolute right-0 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-muted-foreground/40 lg:-right-4 lg:block" />
              )}
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <Reveal className="text-center">
            <h2 className="text-2xl font-extrabold tracking-tight">The output is a defensible training record</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Every action in the app is designed to answer a surveyor's practical question:
              who needed training, who completed it, who verified it, and where is the proof?
            </p>
          </Reveal>
          <div className="mt-8 grid gap-3">
            {DELIVERABLES.map((item) => (
              <Reveal key={item}>
                <div className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span className="text-sm text-foreground/85">{item}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
