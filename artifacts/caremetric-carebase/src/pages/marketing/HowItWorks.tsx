import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileStack,
  Network,
  Target,
} from "lucide-react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import { STEPS } from "@/components/marketing/content";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

const IMPLEMENTATION_SEQUENCE = [
  "Foundation: confirm facilities, license types, roles, access scope, residents, employees, and the records that will be imported or retained in another system.",
  "Rules: configure training plans, credential and practicum requirements, resident deadlines, alert windows, review gates, and facility workflows.",
  "Adoption: invite users and launch the highest-value workflows first—typically training and qualification, resident compliance, incidents, daily work, or survey readiness.",
  "Proof: review dashboards and work queues, resolve baseline gaps, validate reports, and generate the first facility-scoped binder or evidence room.",
];

const DELIVERABLES = [
  "Employee training and compliance plans tied to role, facility, and license type",
  "Completion evidence from assigned training, live classes, outside records, practicums, services, attestations, observations, approvals, and manager reviews",
  "Operational work across admissions, residents, dietary, scheduling, incidents, complaints, emergency readiness, maintenance, finance, and quality routed to an owner",
  "Dashboards, alerts, certificates, documents, regulatory crosswalks, evidence rooms, audit history, reports, and binder exports",
];

const DEMO_PREP = [
  {
    icon: FileStack,
    title: "Your current tool list",
    description:
      "Bring the spreadsheets, shared folders, calendars, LMS, logs, and point tools involved in the workflow.",
  },
  {
    icon: Target,
    title: "One high-risk workflow",
    description:
      "Choose a real example such as new-hire readiness, resident reassessment, incident follow-up, or survey evidence.",
  },
  {
    icon: Network,
    title: "Your role and access map",
    description:
      "Identify who starts the work, who completes it, who verifies it, and who should only review the result.",
  },
  {
    icon: ClipboardList,
    title: "One finished record",
    description:
      "Use a de-identified binder, report, checklist, or packet to define what defensible completion looks like.",
  },
] as const;

export default function HowItWorks() {
  usePageMeta({ ...MARKETING_ROUTE_META["/how-it-works"], path: "/how-it-works" });
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="One closed-loop operating model"
        title="From facility setup to daily work to defensible evidence"
        subtitle="Configure what applies, route each action to the right role, capture proof as the work happens, and use live risk views to decide what needs attention next."
        highlights={[
          "Configure what applies",
          "Assign owners and deadlines",
          "Preserve the evidence trail",
        ]}
      />

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.1} className="relative">
              <Card className="h-full border-border/60 p-6 shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.description}
                </p>
              </Card>
              {i < STEPS.length - 1 && (
                <ArrowRight className="absolute right-0 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-muted-foreground/40 lg:-right-4 lg:block" />
              )}
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Make the demo specific
            </p>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight">
              Bring four things to a workflow-mapping session
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The most useful evaluation follows one of your records from trigger
              to proof. These inputs let the team show what CareBase replaces,
              what remains connected, and where ownership changes.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {DEMO_PREP.map((item, index) => (
              <Reveal key={item.title} delay={index * 0.05}>
                <Card className="h-full border-border/60 p-6 shadow-sm">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                    <item.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>
          <Reveal className="mx-auto mt-8 max-w-3xl rounded-2xl border border-primary/20 bg-primary/[0.035] p-5 text-center text-sm leading-6 text-muted-foreground">
            The output is a workflow map: source record, responsible roles,
            deadlines, review gates, evidence, replacement candidates, and known
            system boundaries. It is an evaluation aid—not a fixed implementation timeline.
          </Reveal>
        </div>
      </section>

      <section className="border-y border-border/60 bg-background">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-primary shadow-sm">
              <Clock3 className="h-3.5 w-3.5" />
              Practical implementation sequence
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
              Launch in the order that matches your highest-risk workflow
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              There is no universal four-week promise. The sequence is consistent,
              but timing depends on facility count, data quality, integrations, and
              how many workflows an organization chooses to launch at once.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-3">
            {IMPLEMENTATION_SEQUENCE.map((item) => (
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

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <Reveal className="text-center">
            <h2 className="text-2xl font-extrabold tracking-tight">
              The output is a defensible facility record
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Every action in the app is designed to answer a surveyor's
              practical question: what was required, who completed it, who
              verified it, and where is the proof?
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

      <section className="mx-auto max-w-7xl px-4 py-14 text-center sm:px-6 lg:px-8">
        <Reveal>
          <Link
            href="/savings"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Map the workflow to replacement and savings
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
