import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  Workflow,
} from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import { FEATURE_CATEGORIES } from "@/components/marketing/content";
import { usePageMeta } from "@/lib/usePageMeta";

const PROOF_CHAIN = [
  {
    icon: ClipboardList,
    title: "Requirement",
    description:
      "Start with the training hour, credential, resident assessment, policy, incident, or inspection item your facility must prove.",
  },
  {
    icon: Workflow,
    title: "Workflow",
    description:
      "Assign the right action to the right role: employee training, trainer class, manager review, admin approval, or auditor read-only review.",
  },
  {
    icon: FileSearch,
    title: "Evidence",
    description:
      "Store the certificate, sign-in, attestation, generated PDF, document upload, and audit event together so the record is explainable later.",
  },
];

const FEATURE_OUTCOMES = [
  "Connect workforce compliance, resident operations, facility work, quality follow-up, and survey evidence instead of managing each in a separate tracker.",
  "See overdue, expiring, completed, blocked, and missing evidence before survey day.",
  "Give owners, managers, trainers, employees, and auditors a secure role-specific workspace instead of one generic admin dashboard.",
  "Keep the EHR, eMAR, payroll, HRIS, and accounting platforms that remain authoritative while replacing the coordination spreadsheets around them.",
];

export default function Features() {
  usePageMeta({
    title: "Features — CareMetric CareBase Facility Management Software",
    description:
      "See CareMetric CareBase features across staff compliance, training, resident and facility operations, quality, safety, scheduling, documents, and survey evidence.",
    path: "/features",
  });
  return (
    <MarketingLayout>
      <PageHero
        title="Every operational record should lead to the work, the owner, and the proof"
        subtitle="CareMetric CareBase connects workforce compliance, resident and facility operations, training, scheduling, safety, quality, documents, alerts, and survey evidence—while leaving clinical charting, medication administration, payroll, and accounting in their authoritative systems."
      />

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight">
              What changes after you launch
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Instead of asking managers to manually chase certificates,
              reconcile sign-in sheets, and rebuild binders, CareMetric CareBase
              keeps every training signal connected to the employee, facility,
              role, and deadline it belongs to.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {FEATURE_OUTCOMES.map((outcome) => (
              <div
                key={outcome}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm text-foreground/85">{outcome}</span>
              </div>
            ))}
            <Link
              href="/savings"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              See exactly what it can replace
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-extrabold tracking-tight">
              Every feature supports the same proof chain
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Buyers should not have to guess how a feature turns into survey
              evidence. CareMetric CareBase organizes each module around a simple
              chain: define the requirement, route the work, and preserve the
              proof.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {PROOF_CHAIN.map((item, i) => (
              <Reveal key={item.title} delay={i * 0.06}>
                <Card className="h-full border-border/60 p-6 shadow-sm">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-8 ring-primary/[0.03]">
                    <item.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mt-5 text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Jump nav -- the feature set spans 8 categories, so let visitors skip to what matters to them. */}
      <nav
        aria-label="Feature categories"
        className="border-b border-border/60 bg-background"
      >
        <div className="mx-auto max-w-7xl overflow-x-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
            {FEATURE_CATEGORIES.map((cat) => (
              <a
                key={cat.id}
                href={`#${cat.id}`}
                className="whitespace-nowrap rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {cat.category}
              </a>
            ))}
          </div>
        </div>
      </nav>

      {FEATURE_CATEGORIES.map((cat, catIndex) => (
        <section
          key={cat.id}
          id={cat.id}
          className={`mx-auto max-w-7xl scroll-mt-16 px-4 py-16 sm:px-6 lg:px-8 ${
            catIndex < FEATURE_CATEGORIES.length - 1
              ? "border-b border-border/60"
              : ""
          }`}
        >
          <Reveal className="max-w-2xl">
            <h2 className="text-2xl font-extrabold tracking-tight">
              {cat.category}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {cat.blurb}
            </p>
          </Reveal>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cat.items.map((feature, i) => (
              <Reveal key={feature.title} delay={(i % 3) * 0.05}>
                <Card className="group h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                  <CardHeader>
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-8 ring-primary/[0.03]">
                      <feature.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-base">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>
      ))}

      <section className="mx-auto max-w-7xl px-4 pb-16 pt-4 text-center sm:px-6 lg:px-8">
        <Reveal className="flex flex-wrap items-center justify-center gap-6">
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            See the workflow
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/savings"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Model value and savings
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
