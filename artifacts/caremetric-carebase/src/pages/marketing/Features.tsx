import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

const RESIDENT_LIFECYCLE = [
  {
    label: "01 — Inquiry & admission",
    title: "Inquiry & admission",
    description:
      "Prospect tracking, preadmission RASP/ASP screening, room readiness, and the resident agreement — handled before move-in day.",
  },
  {
    label: "02 — First 15 days",
    title: "First 15 days",
    description:
      "The initial assessment lands on its own regulatory clock, the support plan opens automatically, and orientation evidence attaches to the record.",
  },
  {
    label: "03 — Every day",
    title: "Every day",
    description:
      "Services assigned and recorded — completed, refused, or escalated — plus dietary rounds, appointments, transportation, and routed medication events.",
  },
  {
    label: "04 — When something changes",
    title: "When something changes",
    description:
      "A fall or hospital return routes provider notification, reassessment, support-plan review, and documented follow-up — no informal handoffs.",
  },
  {
    label: "05 — Every year",
    title: "Every year",
    description:
      "Annual reassessment is scheduled automatically — and completing it triggers the support-plan update Chapter 2600 and 2800 require.",
  },
  {
    label: "06 — Move-out",
    title: "Move-out",
    description:
      "Discharge documentation, financial closeout, and a retained record that still answers a surveyor's question months later.",
  },
] as const;

type CapabilityGroup = {
  id: string;
  anchorAliases?: readonly string[];
  title: string;
  items: readonly string[];
};

const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  {
    id: "training-compliance",
    title: "Training & compliance core",
    items: [
      "Today — one daily command center for due work",
      "Compliance tracking & automatic alerts",
      "Built-in course builder with graded quizzes",
      "Competency checklists & templates",
      "Role-based training plans",
      "Custom requirement catalog",
      "Interactive compliance matrix + CSV export",
      "Compliance reporting center",
      "Audit-ready document storage",
    ],
  },
  {
    id: "ai-course-creation",
    anchorAliases: ["live-classes"],
    title: "AI, copilot & live training",
    items: [
      "AI curriculum generation from your documents",
      "AI avatar video lessons",
      "Targeted block-level regeneration",
      "Grounded compliance copilot — cited, read-only answers",
      "Live class scheduling & digital sign-in",
      "Rotating QR & kiosk PIN check-in",
      "Printable meeting notices with QR",
    ],
  },
  {
    id: "resident-care",
    anchorAliases: ["resident-operations"],
    title: "Resident care & operations",
    items: [
      "Digital RASP/ASP assessment prep",
      "Automatic reassessment & support-plan triggers",
      "Facility-wide resident compliance dashboard",
      "Admissions, census & room readiness",
      "Resident services & daily work",
      "Change-of-condition follow-up",
      "Dietary & food-safety operations",
      "Services calendar & transportation",
      "Resident financial subledger",
      "Medication event integration",
    ],
  },
  {
    id: "survey-readiness",
    anchorAliases: ["facility-operations"],
    title: "Survey, safety & facility",
    items: [
      "One-click compliance binder PDF",
      "Citation-weighted readiness score",
      "Survey Day Mode command workspace",
      "Incident & complaint tracking with notification clocks",
      "Violations & plan-of-correction workflow",
      "Fire drills & life-safety records",
      "60+ template document library",
      "Emergency operations",
      "Maintenance & work orders",
      "QAPI & quality projects",
      "Closed-loop work queue",
      "Evidence rooms & regulatory crosswalk",
    ],
  },
  {
    id: "credentials-screening",
    anchorAliases: ["scheduling"],
    title: "Credentials & workforce",
    items: [
      "Credentials & clearances (Act 34 / 73 / 33, licenses, TB, I-9)",
      "OAPSA provisional-employment countdown",
      "Monthly OIG / SAM exclusion screening",
      "Administrator qualification & CE tracking",
      "Live pass-meds authorization roster",
      "Policy attestation campaigns (ESIGN/UETA evidence)",
      "Shift scheduling & auto-fill",
      "Cross-facility float staff",
    ],
  },
  {
    id: "access-onboarding",
    title: "Access & onboarding",
    items: [
      "Six database-enforced roles",
      "Public certificate verification links",
      "Bulk CSV employee import",
      "Email, SMS & in-app alerts with escalation",
      "Email-invite user provisioning",
      "Instant self-service signup",
      "Installable mobile app for employees",
    ],
  },
] as const;

const USER_ROLES = [
  {
    title: "Owner / executive",
    sees: "org-wide rollups, trends, and unresolved risk across every facility.",
    does:
      "compares facilities and reviews readiness before leadership or diligence questions arrive.",
  },
  {
    title: "Org admin",
    sees: "compliance across the whole organization, including resident assessments.",
    does: "configures rules, requirements, and access once for every facility.",
  },
  {
    title: "Facility manager",
    sees: "assigned sites only — overdue staff, open work, shift coverage.",
    does: "resolves gaps, approves work, validates outside training records.",
  },
  {
    title: "Trainer",
    sees: "class rosters, retraining queues, and course drafts.",
    does:
      "runs classes with QR check-in, drafts AI-assisted courses, manages practicum evidence.",
  },
  {
    title: "Employee",
    sees: "their own assignments, schedule, and certificates — never coworker data.",
    does: "completes training, signs policies, and uploads records from their phone.",
  },
  {
    title: "Auditor / surveyor",
    sees: "read-only evidence scoped to exactly what was requested.",
    does: "reviews the record without the ability to change anything.",
  },
] as const;

const RECENTLY_SHIPPED = [
  {
    tag: "Survey Day Mode",
    title: "A single workspace for the entrance conference",
    body:
      "When a licensing surveyor arrives, one screen pins the entrance-conference checklist and its live readiness, your latest compliance binder, a searchable on-shift staff roster with training and clearance flags, and the evidence rooms you've prepared. Activation and closure are facility-scoped audit events, and nothing new is created or exposed — it surfaces the proof you already have.",
  },
  {
    tag: "Compliance Copilot",
    title: "Cited answers, grounded in your own records",
    body:
      "Ask why an employee is blocked, what's due in 30 days, which residents lack a current medical evaluation, or for a drafted Plan of Correction. Every answer is read-only synthesis over governed rule versions and your facility's own evidence, carrying its source, effective date, and citation — and human confirmation stays mandatory, so a draft is never approved or submitted on its own.",
  },
  {
    tag: "Today",
    title: "The daily home for everything that's due",
    body:
      "One screen shows the full count of work due across a single facility or the whole portfolio, with overdue items called out first — so the morning question of “what needs doing today” has one answer instead of six spreadsheets.",
  },
] as const;

function DarkSurface({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden">
      <TechGrid />
      <div className="relative mx-auto max-w-[1160px] px-6 py-[72px]">
        {children}
      </div>
    </div>
  );
}

export default function Features() {
  usePageMeta({ ...MARKETING_ROUTE_META["/features"], path: "/features" });

  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <Reveal className="relative mx-auto flex max-w-[860px] flex-col items-center gap-3.5 px-6 py-14 text-center">
          <h1 className="m-0 text-balance text-[42px] font-bold leading-[1.1] tracking-[-0.015em] max-sm:text-4xl">
            Everything CareBase does, in one place
          </h1>
          <p className="m-0 max-w-[56ch] text-pretty text-base text-white/85">
            The complete capability index and the six roles that use it. Every
            plan includes all of it — no modules, no upsells, unlimited staff
            and residents.
          </p>
        </Reveal>
      </section>

      <section
        id="recently-shipped"
        className="scroll-mt-24 border-b border-[#e5eaf0] bg-white"
      >
        <div className="mx-auto max-w-[1160px] px-6 py-[72px]">
          <Reveal className="mx-auto flex max-w-[640px] flex-col gap-2.5 text-center">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">
              Recently shipped
            </p>
            <h2 className="m-0 text-[32px] font-bold leading-tight tracking-[-0.01em] text-[#0d2742]">
              The newest capabilities, explained
            </h2>
            <p className="m-0 text-[15px] text-[#44566b]">
              All three are in the full index below too — but these change the
              day-to-day the most, so they're worth a closer look.
            </p>
          </Reveal>
          <div className="mt-9 grid gap-3.5 md:grid-cols-3">
            {RECENTLY_SHIPPED.map((item, index) => (
              <Reveal key={item.tag} delay={(index % 3) * 0.05}>
                <article className="flex h-full flex-col gap-2.5 rounded-xl border border-[#dfe6ee] bg-[#f6f8fa] p-6">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[#eaf6ec] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[#1e7a35]">
                      New
                    </span>
                    <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#1b6fc2]">
                      {item.tag}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-[#0d2742]">
                    {item.title}
                  </h3>
                  <p className="text-[13.5px] leading-[1.55] text-[#44566b]">
                    {item.body}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section
        id="resident-lifecycle"
        className="scroll-mt-24 bg-[#071626] text-white"
      >
        <DarkSurface>
          <Reveal className="flex max-w-[640px] flex-col gap-2.5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#8ec8ff]">
              The resident lifecycle
            </p>
            <h2 className="m-0 text-balance text-[32px] font-bold leading-tight tracking-[-0.01em]">
              Every resident, managed from inquiry to move-out
            </h2>
            <p className="m-0 text-[15px] text-white/82">
              Staff compliance is half the job. The other half — assessments,
              support plans, daily services — is where surveyors spend their
              afternoon. Same record, same due dates.
            </p>
          </Reveal>
          <div className="mt-8 grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {RESIDENT_LIFECYCLE.map((item, index) => (
              <Reveal key={item.label} delay={(index % 3) * 0.05}>
                <article className="flex h-full flex-col gap-2 rounded-xl border border-white/15 bg-white/[0.06] p-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#8ec8ff]">
                    {item.label}
                  </p>
                  <h3 className="sr-only">{item.title}</h3>
                  <p className="m-0 text-[13.5px] leading-[1.55] text-white/82">
                    {item.description}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
        </DarkSurface>
      </section>

      <section
        id="capability-index"
        className="scroll-mt-24 border-b border-[#e5eaf0] bg-[#f6f8fa]"
      >
        <div className="mx-auto max-w-[1160px] px-6 py-[72px]">
          <Reveal className="mx-auto flex max-w-[620px] flex-col gap-2.5 text-center">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">
              Everything included
            </p>
            <h2 className="m-0 text-[32px] font-bold leading-tight tracking-[-0.01em] text-[#0d2742]">
              50+ capabilities. One price. No add-on modules.
            </h2>
            <p className="m-0 text-[15px] text-[#44566b]">
              Every plan ships the complete platform — this is the full index.
            </p>
          </Reveal>

          <div className="mt-9 grid items-start gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {CAPABILITY_GROUPS.map((group, index) => (
              <Reveal key={group.id} delay={(index % 3) * 0.05}>
                <article
                  id={group.id}
                  className="relative scroll-mt-24 rounded-xl border border-[#dfe6ee] bg-white p-5"
                >
                  {group.anchorAliases?.map((alias) => (
                    <span
                      key={alias}
                      id={alias}
                      className="absolute -top-24"
                      aria-hidden="true"
                    />
                  ))}
                  <h3 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#5d7084]">
                    {group.title}
                  </h3>
                  <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-[#33465c]">
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section
        id="roles"
        className="scroll-mt-24 border-b border-[#e5eaf0] bg-white"
      >
        <div className="mx-auto max-w-[1160px] px-6 py-[72px]">
          <Reveal className="mx-auto flex max-w-[620px] flex-col gap-2.5 text-center">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">
              Built for every role
            </p>
            <h2 className="m-0 text-[32px] font-bold leading-tight tracking-[-0.01em] text-[#0d2742]">
              Six roles, each scoped to exactly their job
            </h2>
            <p className="m-0 text-[15px] text-[#44566b]">
              Access is enforced in the database itself — not just by hiding menus.
            </p>
          </Reveal>

          <div className="mt-9 grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {USER_ROLES.map((role, index) => (
              <Reveal key={role.title} delay={(index % 3) * 0.05}>
                <article className="flex h-full flex-col gap-2 rounded-xl border border-[#dfe6ee] bg-white p-5">
                  <h3 className="text-[15px] font-bold text-[#0d2742]">
                    {role.title}
                  </h3>
                  <p className="text-[13px] text-[#44566b]">
                    <strong className="text-[#33465c]">Sees:</strong> {role.sees}
                  </p>
                  <p className="text-[13px] text-[#44566b]">
                    <strong className="text-[#33465c]">Does:</strong> {role.does}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#071626] text-white">
        <Reveal className="mx-auto flex max-w-[860px] flex-col items-center gap-3.5 px-6 py-14 text-center">
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.01em]">
            Every capability, from day one of the trial
          </h2>
          <p className="m-0 max-w-[52ch] text-[15px] text-white/82">
            Import your roster and see your own facility's compliance picture
            this week.
          </p>
          <div className="mt-1.5 flex flex-wrap justify-center gap-3">
            <Button
              asChild
              variant="secondary"
              className="rounded-[9px] bg-white px-5 py-3 text-[14.5px] font-bold text-[#0d2742] hover:bg-[#dcebfa]"
            >
              <Link href="/signup">Start a free trial</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="rounded-[9px] border-white/30 bg-transparent px-5 py-3 text-[14.5px] font-bold text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/faq">Questions? Read the FAQ</Link>
            </Button>
          </div>
        </Reveal>
      </section>
    </MarketingLayout>
  );
}
