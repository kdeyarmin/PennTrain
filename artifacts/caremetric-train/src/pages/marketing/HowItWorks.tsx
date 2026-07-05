import { ArrowRight } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import { STEPS } from "@/components/marketing/content";

export default function HowItWorks() {
  return (
    <MarketingLayout>
      <PageHero
        title="Up and running in three steps"
        subtitle="Stand up your organization, assign the training your license type requires, and stay survey-ready year round."
      />

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.step} delay={i * 0.1} className="relative">
              <div className="font-mono text-5xl font-semibold tabular-nums text-primary/15">
                {step.step}
              </div>
              <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
              {i < STEPS.length - 1 && (
                <ArrowRight className="absolute right-0 top-2 hidden h-5 w-5 text-muted-foreground/40 lg:-right-6 lg:block" />
              )}
            </Reveal>
          ))}
        </div>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
