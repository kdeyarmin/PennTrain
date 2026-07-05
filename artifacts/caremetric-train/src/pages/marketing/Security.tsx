import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal, TechGrid, TechIcon } from "@/components/marketing/primitives";
import { SECURITY_FEATURES } from "@/components/marketing/content";

export default function Security() {
  return (
    <MarketingLayout>
      <PageHero
        title="Enterprise-grade security, built in"
        subtitle="Your training and compliance data is sensitive. It's protected at the database layer, not bolted on as an afterthought."
      />

      <section className="relative overflow-hidden bg-gradient-to-br from-[#0a1a2e] via-[#102a43] to-[#16324f] text-white">
        <TechGrid />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="grid gap-6 sm:grid-cols-2">
            {SECURITY_FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={(i % 2) * 0.08}>
                <div className="flex h-full gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition-colors hover:border-[#59b2ff]/40">
                  <TechIcon icon={feature.icon} />
                  <div>
                    <h3 className="font-semibold text-white">{feature.title}</h3>
                    <p className="mt-1.5 text-sm text-white/60">
                      {feature.description}
                    </p>
                  </div>
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
