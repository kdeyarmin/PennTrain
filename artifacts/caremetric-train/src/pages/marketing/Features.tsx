import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import { FEATURES } from "@/components/marketing/content";

export default function Features() {
  return (
    <MarketingLayout>
      <PageHero
        title="Everything compliance requires. Nothing it doesn't."
        subtitle="From day-one onboarding to survey day, CareMetric Train covers the full lifecycle of staff training and documentation."
      />

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-x-12 gap-y-9 sm:grid-cols-2">
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.title} delay={(i % 4) * 0.05}>
              <div className="flex gap-4 border-t border-border/70 pt-6">
                <span className="pt-0.5 font-mono text-xs tabular-nums text-muted-foreground/50">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <feature.icon className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold">{feature.title}</h3>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
