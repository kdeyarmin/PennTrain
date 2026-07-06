import { CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal, TechGrid, TechIcon } from "@/components/marketing/primitives";
import { SECURITY_FEATURES } from "@/components/marketing/content";

const SECURITY_PROMISES = [
  "Users are scoped by organization, facility, and role before records are shown.",
  "Private evidence files use short-lived access links instead of public buckets.",
  "Compliance-impacting actions are preserved in an audit trail for review.",
  "A facility outside a viewer's assigned scope shows as 'Not Assigned' -- never a false all-clear.",
];

export default function Security() {
  return (
    <MarketingLayout>
      <PageHero
        title="Enterprise-grade security, built in"
        subtitle="Your training and compliance data is sensitive. CareMetric Train protects it with role-aware workflows, private evidence storage, and database-enforced access boundaries."
      />

      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="absolute right-0 top-0 h-[420px] w-[420px] -translate-y-1/3 translate-x-1/4 rounded-full bg-[#59b2ff]/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/10">
              <LockKeyhole className="h-7 w-7 text-[#59b2ff]" />
            </div>
            <h2 className="mt-5 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              Security is part of the product workflow, not a separate promise page.
            </h2>
            <p className="mt-4 text-white/68">
              The same boundaries that make the app easier to use also reduce risk:
              managers see their facilities, employees see their own assignments, and
              auditors can review evidence without changing records.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {SECURITY_FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={(i % 2) * 0.08}>
                <div className="flex h-full gap-4 rounded-xl border border-white/10 bg-white/[0.055] p-6 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#59b2ff]/40 hover:bg-white/[0.075]">
                  <TechIcon icon={feature.icon} />
                  <div>
                    <h3 className="font-semibold text-white">{feature.title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-white/62">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-primary shadow-sm">
              <ShieldCheck className="h-3.5 w-3.5" />
              Practical safeguards for survey evidence
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">Designed around least-privilege access</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Compliance systems collect sensitive employee records, signatures,
              certificates, credentials, and corrective-action evidence. CareMetric
              Train keeps those assets organized without making them broadly visible.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {SECURITY_PROMISES.map((promise) => (
              <div key={promise} className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm text-foreground/85">{promise}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
