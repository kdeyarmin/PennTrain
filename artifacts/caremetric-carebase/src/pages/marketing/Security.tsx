import {
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileLock2,
  KeyRound,
  LockKeyhole,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import {
  PageHero,
  Reveal,
  TechGrid,
  TechIcon,
} from "@/components/marketing/primitives";
import { SECURITY_FEATURES } from "@/components/marketing/content";
import { usePageMeta } from "@/lib/usePageMeta";

const SECURITY_CHECKLIST = [
  "Can a facility manager only access assigned-facility records?",
  "Can an employee see their own training without seeing coworker credentials?",
  "Can an auditor review evidence without changing it?",
  "Can support impersonation, AI review, certificate issuance, and policy signatures be audited later?",
];

const SECURITY_PROMISES = [
  "Users are scoped by organization, facility, and role before records are shown.",
  "Private evidence files use short-lived access links instead of public buckets.",
  "Compliance-impacting actions are preserved in an audit trail for review.",
  "A facility outside a viewer's assigned scope shows as 'Not Assigned' -- never a false all-clear.",
];

const DUE_DILIGENCE_AREAS = [
  {
    icon: KeyRound,
    title: "Identity and access",
    verify:
      "Role permissions, organization and facility scope, employee self-service boundaries, MFA support, and auditor read-only behavior.",
  },
  {
    icon: FileLock2,
    title: "Evidence and file handling",
    verify:
      "Private storage, short-lived access links, controlled evidence sharing, record ownership, and file access boundaries.",
  },
  {
    icon: Database,
    title: "Operational controls",
    verify:
      "Database-enforced policies, approval and review gates, audit events, support access, and out-of-scope facility behavior.",
  },
  {
    icon: ScrollText,
    title: "Deployment and contract",
    verify:
      "Hosting responsibility, backups, recovery, retention and deletion, incident response, subprocessors, and any required agreement or certification.",
  },
] as const;

export default function Security() {
  usePageMeta({
    title: "Security — CareMetric CareBase",
    description:
      "See the database-enforced roles, private storage, audit controls, MFA support, review gates, and evidence boundaries built into CareMetric CareBase.",
    path: "/security",
  });
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="Security and trust"
        title="Security controls buyers can verify in the product"
        subtitle="CareMetric CareBase protects facility, resident, staff, training, and compliance records with role-aware workflows, private evidence storage, database-enforced access boundaries, and reviewable audit evidence."
        highlights={[
          "Database-enforced scope",
          "Private evidence storage",
          "Reviewable security events",
        ]}
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
              Security is part of the product workflow, not a separate promise
              page.
            </h2>
            <p className="mt-4 text-white/68">
              The same boundaries that make the app easier to use also reduce
              risk: managers see their facilities, employees see their own
              assignments, and auditors can review evidence without changing
              records.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {SECURITY_FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={(i % 2) * 0.08}>
                <div className="flex h-full gap-4 rounded-xl border border-white/10 bg-white/[0.055] p-6 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#59b2ff]/40 hover:bg-white/[0.075]">
                  <TechIcon icon={feature.icon} />
                  <div>
                    <h3 className="font-semibold text-white">
                      {feature.title}
                    </h3>
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
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
              Designed around least-privilege access
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Compliance systems collect sensitive employee records, signatures,
              certificates, credentials, and corrective-action evidence.
              CareMetric CareBase keeps those assets organized without making them
              broadly visible.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {SECURITY_PROMISES.map((promise) => (
              <div
                key={promise}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm text-foreground/85">{promise}</span>
              </div>
            ))}
            <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4 text-sm leading-6 text-muted-foreground">
              These product controls are not, by themselves, a claim of a particular
              certification, a signed business associate agreement, or compliance for
              every deployment. Buyers should confirm the hosted environment, contract,
              retention requirements, and organizational safeguards that apply to their use.
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Buyer due diligence
            </p>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight">
              Evaluate product controls and deployment obligations separately
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              A secure workflow is only one part of a security review. Use these
              four areas to verify the product behavior you can see and the
              operating commitments that belong in hosting and contract review.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {DUE_DILIGENCE_AREAS.map((area, index) => (
              <Reveal key={area.title} delay={(index % 2) * 0.06}>
                <article className="flex h-full gap-4 rounded-2xl border bg-card p-6 shadow-sm">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <area.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{area.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {area.verify}
                    </p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-primary shadow-sm">
              <ClipboardCheck className="h-3.5 w-3.5" />
              Questions security-minded buyers ask
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
              Trust claims are translated into verifiable product behavior
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Instead of relying on broad promises, CareMetric CareBase frames
              safeguards as practical access questions buyers can validate
              during a demo.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {SECURITY_CHECKLIST.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm text-foreground/85">{item}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
