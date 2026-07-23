import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  GraduationCap,
  Pill,
  ScanLine,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/Logo";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

type HeroMetric = { value: string; label: string };
type PlainEnglishCard = {
  number: string;
  eyebrow: string;
  title: string;
  copy: string;
  href?: string;
  link?: string;
};
type Persona = {
  chapter: string;
  title: string;
  copy: string;
  warning: string;
  tags: string[];
  cta: string;
};
type Domain = {
  label: string;
  title: string;
  intro: string;
  tags: string[];
  note: string;
  mockup: ReactNode;
};
type DiffItem = { old: string; carebase: string };
type Differentiator = {
  icon: LucideIcon;
  title: string;
  body: string[];
  footer: string;
};
type Plan = {
  name: string;
  price: string;
  suffix?: string;
  featured?: boolean;
  tone?: "muted";
  features: string[];
  cta: string;
  href: string;
};
type Faq = { question: string; answer: ReactNode };

const TRIAL_DAYS = 30;
const STARTER_PRICE = "$349";
const GROWTH_PRICE = "$299";

const HERO_ROWS = [
  { label: "Annual in-service hours", status: "On track", value: 92 },
  { label: "Medication practicums", status: "Current", value: 88 },
  { label: "Resident assessments", status: "5 due · scheduled", value: 90 },
] as const;

const HERO_METRICS: HeroMetric[] = [
  {
    value: "12–16 hrs",
    label: "annual training tracked per direct care worker, by facility type",
  },
  {
    value: "Ch. 2600 + 2800",
    label: "PA regulations crosswalked to the records that prove them",
  },
  { value: "60+", label: "survey-ready form templates included" },
  {
    value: "1 record",
    label: "every role — admin to auditor — works from the same evidence",
  },
];

const PLAIN_ENGLISH: PlainEnglishCard[] = [
  {
    number: "01",
    eyebrow: "Survey readiness",
    title: "Pass your next survey",
    copy: "Every §2600 / §2800 requirement lives on its own clock with evidence attached as work happens. When the surveyor knocks, the binder is an export — not a lost weekend.",
    href: "/how-it-works",
    link: "See how it works →",
  },
  {
    number: "02",
    eyebrow: "Education spend",
    title: "Spend less on required education",
    copy: "The course builder, AI course creation from your own policies, live QR classes, and certificates are built in — stop paying per-seat LMS fees and yearly content libraries for the same mandatory topics.",
    href: "/savings",
    link: "See where the money comes from →",
  },
  {
    number: "03",
    eyebrow: "Your time",
    title: "Get your evenings back",
    copy: "The system nags, routes, escalates, and files so compliance stops living in one person's memory — and stops following you home in a tote bag of binders.",
  },
];

const PERSONAS: Persona[] = [
  {
    chapter: "55 Pa. Code Chapter 2600",
    title: "I run a personal care home",
    copy: "Your surveyor wants 12 annual in-service hours per direct care worker (§2600.65, up to 6 on-the-job), current RASP assessments and support plans, medication practicums, Act 34 clearances, and fire drill logs — with proof for each.",
    warning:
      "Your usual failure mode isn't missing training — it's the sign-in sheet nobody can find. CareBase logs the hours as they happen and keeps the evidence attached.",
    tags: ["12-hr buckets auto-applied", "+6 hrs secured dementia unit", "Ch. 2600 crosswalk"],
    cta: "Set up your PCH in minutes →",
  },
  {
    chapter: "55 Pa. Code Chapter 2800",
    title: "I run an assisted living facility",
    copy: "You carry the heavier load: 16 annual hours per direct care worker (§2800.65), dementia training that doesn't count toward the 16 (§2800.69), special-care-unit add-ons, and ASP assessments on their own clocks.",
    warning:
      "The dementia-hours carve-out is where ALFs get cited. CareBase tracks the buckets separately so nothing double-counts.",
    tags: ["16-hr buckets auto-applied", "Dementia hrs tracked separately", "Ch. 2800 crosswalk"],
    cta: "Set up your ALF in minutes →",
  },
];

const DOMAINS: Domain[] = [
  {
    label: "Residents",
    title: "From inquiry to discharge",
    intro:
      "Resident-level compliance and the daily work around it — each item on its own due-date clock.",
    tags: [
      "Admissions & census",
      "RASP / ASP assessments",
      "Support-plan triggers",
      "Resident services & refusals",
      "Change-of-condition follow-up",
      "Dietary & food safety rounds",
      "Appointments & transport",
      "Resident finance subledger",
    ],
    note: "Not an EHR or eMAR — CareBase runs the non-clinical operation around the chart, and routes medication events from your external source.",
    mockup: <ResidentMockup />,
  },
  {
    label: "Workforce",
    title: "Hire to qualified, on its own clock",
    intro:
      "Every requirement a new hire needs — training, clearances, screenings, competencies — routed and tracked automatically by role and facility type.",
    tags: [
      "Training plans by role",
      "Live classes · QR check-in",
      "AI-drafted courses, human-approved",
      "Act 34 / 73 / 33 clearances",
      "Monthly OIG exclusion screening",
      "Pass-meds roster",
      "Shift scheduling & auto-fill",
      "Policy attestations",
    ],
    note: "AI-touched training content can't publish until a named reviewer signs off — and the sign-off clears if any block is regenerated.",
    mockup: <WorkforceMockup />,
  },
  {
    label: "Facility & safety",
    title: "The building, on the record too",
    intro:
      "Incidents, drills, repairs, complaints, and emergencies each generate their own survey-ready PDF trail.",
    tags: [
      "Incidents & notification clocks",
      "Violations & plans of correction",
      "Fire drills & life-safety logs",
      "Emergency operations",
      "Maintenance work orders",
      "Complaints & resident rights",
      "QAPI projects",
    ],
    note: "Reportable incidents auto-schedule the required notifications — state hotline, law enforcement, licensing — each with its own due-by clock.",
    mockup: <FacilityMockup />,
  },
  {
    label: "Survey evidence",
    title: "Ready before the entrance conference",
    intro: "Proof is collected as work happens, so the binder is an export — not a project.",
    tags: [
      "One-click binder PDF",
      "Citation-weighted readiness score",
      "Ch. 2600 / 2800 crosswalk",
      "Time-limited evidence rooms",
      "Immutable audit trail",
      "Report center",
    ],
    note: "60+ printable survey-readiness forms included, adapted from a real PA survey readiness binder.",
    mockup: <EvidenceMockup />,
  },
];

const DIFF_ITEMS: DiffItem[] = [
  {
    old: "Sign-in sheets reconciled once a year",
    carebase: "Hours logged as training happens",
  },
  {
    old: "Binder night before the survey",
    carebase: "Binder PDF generated from live records",
  },
  {
    old: "Expirations discovered by the surveyor",
    carebase: "Alerts escalate before anything lapses",
  },
  {
    old: "Nine spreadsheets, one person who gets them",
    carebase: "One record every role works from",
  },
];

const DIFFERENTIATORS: Differentiator[] = [
  {
    icon: GraduationCap,
    title: "AI course creation with a human gate",
    body: [
      "Paste a regulation, policy, or reference document and CareBase drafts the complete course — modules, lesson text or video scripts, and graded quizzes — grounded strictly in your source. It flags gaps instead of inventing citations.",
      "Add an AI avatar presenter video if you want one. Nothing publishes until a named reviewer signs off — and the sign-off clears automatically the moment any block is regenerated.",
    ],
    footer: "Reviewed by a real person, every time",
  },
  {
    icon: ClipboardCheck,
    title: "Citation-weighted readiness score",
    body: [
      "A live, per-facility score weighted by how often DHS actually cites each regulation — not a generic checklist percentage.",
      "Training, credentials, background checks, inspections, incidents, and policy attestations roll into one number, sorted so your most-citable exposure surfaces first.",
    ],
    footer: "See what the surveyor will flag, first",
  },
  {
    icon: Pill,
    title: "Live pass-meds authorization roster",
    body: [
      "The question a surveyor asks on-site: who is authorized to administer medications right now?",
      "One roster cross-checks each employee's medication-administration certification, current-year practicum, and insulin authorization into a single yes or no.",
    ],
    footer: "One answer per employee, always current",
  },
  {
    icon: ScanLine,
    title: "Paperless live-class attendance",
    body: [
      "Each class shows a QR code that rotates every 30 seconds — staff scan with their own phones, or a shared kiosk takes name and PIN. No app installs.",
      "A printable meeting notice with an embedded QR and a backup paper table covers anyone who can't scan; upload the completed sheet back into the class record.",
    ],
    footer: "Hours count the moment they sign in",
  },
];

const PLANS: Plan[] = [
  {
    name: "Single facility",
    price: STARTER_PRICE,
    suffix: " / facility / month",
    features: [
      "All modules — residents, workforce, facility, evidence",
      "Unlimited employees & residents",
      "Email + SMS alerts, binder exports",
      "Self-serve setup, CSV roster import",
    ],
    cta: `Start ${TRIAL_DAYS}-day free trial`,
    href: "/signup",
  },
  {
    name: "Organization · 3+ facilities",
    price: GROWTH_PRICE,
    suffix: " / facility / month",
    featured: true,
    features: [
      "Everything in Single facility",
      "Org-wide rollups & facility comparisons",
      "Cross-facility float staff scheduling",
      "Controlled evidence rooms for auditors",
    ],
    cta: `Start ${TRIAL_DAYS}-day free trial`,
    href: "/signup",
  },
  {
    name: "Enterprise & groups",
    price: "Custom",
    tone: "muted",
    features: [
      "Volume pricing across 10+ facilities",
      "Guided migration & onboarding",
      "Contract, hosting & security review",
      "Priority support",
    ],
    cta: "Talk to us",
    href: "/signup",
  },
];

const START_STEPS = [
  ["Create your organization", "name, facility type, admin email. About two minutes."],
  ["Import your roster", "one CSV brings every employee in; add facilities as you go."],
  [
    "Requirements apply themselves",
    "hour buckets, renewal windows, and alerts start from your facility type and each person's role.",
  ],
  ["Export your first binder", "see your real compliance picture the same day."],
] as const;

const FAQS: Faq[] = [
  {
    question: "What is CareBase?",
    answer:
      "The operations, workforce-compliance, and survey-readiness platform for Pennsylvania personal care homes and assisted living facilities. Not an EHR or eMAR.",
  },
  {
    question: "How much does it cost?",
    answer: (
      <>
        From {GROWTH_PRICE}/facility/month for multi-site organizations, {STARTER_PRICE} for a single facility — every module,
        unlimited staff. <a href="#pricing">See pricing.</a>
      </>
    ),
  },
  {
    question: "What does it replace — and not replace?",
    answer:
      "Replaces training spreadsheets, paper binders, point trackers, and basic scheduling. Works alongside — never replaces — your eMAR, EHR, payroll, HRIS, and accounting.",
  },
  {
    question: "Can a surveyor or auditor get access?",
    answer:
      "Yes — a read-only auditor role, plus time-limited evidence rooms scoped to exactly what was requested.",
  },
  {
    question: "How fast can we start?",
    answer:
      "Same day. Self-serve signup creates your organization; CSV import onboards a full roster in minutes.",
  },
];

const cardClass =
  "rounded-[14px] border border-[#dfe6ee] bg-white p-6 shadow-[0_6px_20px_rgba(13,39,66,0.04)]";
const mutedText = "text-[#44566b]";
const aaMutedText = "text-[#5d7084]";

function ProgressBar({ value, amber = false }: { value: number; amber?: boolean }) {
  return (
    <div className={amber ? "h-2 rounded-full bg-[#f3e4c2]" : "h-2 rounded-full bg-[#edf1f5]"}>
      <div
        className={
          amber
            ? "h-2 rounded-full bg-[#d99a1b]"
            : "h-2 rounded-full bg-gradient-to-r from-[#1b6fc2] to-[#59b2ff]"
        }
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function PillTag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[#dbe3ec] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#33465c]">
      {children}
    </span>
  );
}

function CheckLine({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 text-[13.5px] text-[#33465c]">
      <Check className="mt-0.5 h-4 w-4 shrink-0 stroke-[3] text-[#1e7a35]" />
      <span>{children}</span>
    </div>
  );
}

function ResidentMockup() {
  const rows = [
    ["M. Alvarez", "12", "Current", "Updated May 2", "success"],
    ["J. Okafor", "07", "Annual due · 14d", "Review opened", "warn"],
    ["R. Santos", "21", "Overdue · 3d", "Reassess first", "danger"],
    ["E. Werner", "09", "Current", "Updated Jun 10", "success"],
  ];
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#dfe6ee] bg-white shadow-[0_10px_30px_rgba(13,39,66,0.07)]">
      <div className="flex flex-col gap-1 border-b border-[#e5eaf0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-bold">Resident compliance — Maple Grove</span>
        <span className={`font-mono text-[11px] ${aaMutedText}`}>Census 42 / 48 · 3 move-ins this month</span>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[520px] grid-cols-[1.2fr_0.5fr_1.1fr_1.1fr] text-[13px]">
          {["Resident", "Room", "RASP status", "Support plan"].map((heading) => (
            <div key={heading} className={`border-b border-[#eef2f6] px-3 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] ${aaMutedText}`}>
              {heading}
            </div>
          ))}
          {rows.map(([name, room, status, plan, tone]) => (
            <FragmentRow key={name} name={name} room={room} status={status} plan={plan} tone={tone} />
          ))}
        </div>
      </div>
      <div className={`border-t border-[#eef2f6] bg-[#fafbfc] px-4 py-3 text-xs ${aaMutedText}`}>
        Completing a reassessment auto-opens the support-plan update it requires — §2600.225/.227 tracked per resident.
      </div>
    </div>
  );
}

function FragmentRow({ name, room, status, plan, tone }: { name: string; room: string; status: string; plan: string; tone: string }) {
  const badge =
    tone === "success"
      ? "bg-[#eaf6ec] text-[#1e7a35]"
      : tone === "warn"
        ? "bg-[#fdf4e3] text-[#8a5a00]"
        : "bg-[#fbe9e7] text-[#a83a2c]";
  return (
    <>
      <div className="border-b border-[#eef2f6] px-3 py-3 font-semibold">{name}</div>
      <div className={`border-b border-[#eef2f6] px-3 py-3 ${aaMutedText}`}>{room}</div>
      <div className="border-b border-[#eef2f6] px-3 py-3">
        <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${badge}`}>{status}</span>
      </div>
      <div className={`border-b border-[#eef2f6] px-3 py-3 ${tone === "danger" ? "font-semibold text-[#a83a2c]" : mutedText}`}>{plan}</div>
    </>
  );
}

function WorkforceMockup() {
  const people = ["J. Miller", "R. Chen", "T. Brooks", "A. Novak", "D. Ferraro"];
  const matrix = [
    ["ok", "ok", "ok", "warn", "ok"],
    ["ok", "warn", "ok", "warn", "ok"],
    ["ok", "ok", "bad", "warn", "ok"],
    ["ok", "ok", "ok", "ok", "ok"],
    ["warn", "ok", "ok", "ok", "ok"],
  ];
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#dfe6ee] bg-white shadow-[0_10px_30px_rgba(13,39,66,0.07)]">
      <div className="flex flex-col gap-1 border-b border-[#e5eaf0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-bold">Compliance matrix — direct care staff</span>
        <span className={`font-mono text-[11px] ${aaMutedText}`}>Click any cell to edit the record</span>
      </div>
      <div className="overflow-x-auto p-4">
        <div className="grid min-w-[520px] grid-cols-[110px_repeat(5,1fr)] items-center gap-1.5 text-[11px]">
          <div />
          {["In-service", "Dementia", "Practicum", "Act 34", "TB screen"].map((label) => (
            <div key={label} className={`text-center font-mono text-[9.5px] uppercase ${aaMutedText}`}>{label}</div>
          ))}
          {people.map((person, i) => (
            <FragmentMatrix key={person} person={person} cells={matrix[i]} />
          ))}
        </div>
        <div className={`mt-3 flex flex-wrap items-center gap-4 text-[11.5px] ${aaMutedText}`}>
          <Legend color="bg-[#bfe3c6]" label="Current" />
          <Legend color="bg-[#f2d791]" label="Due soon" />
          <Legend color="bg-[#e8a99f]" label="Overdue — retraining assigned" />
        </div>
      </div>
      <div className={`border-t border-[#eef2f6] bg-[#fafbfc] px-4 py-3 text-xs ${aaMutedText}`}>
        One pass-meds roster cross-checks certification, this year's practicum, and insulin authorization into a single yes/no per aide.
      </div>
    </div>
  );
}

function FragmentMatrix({ person, cells }: { person: string; cells: string[] }) {
  const colors: Record<string, string> = { ok: "bg-[#bfe3c6]", warn: "bg-[#f2d791]", bad: "bg-[#e8a99f]" };
  return (
    <>
      <div className="font-semibold">{person}</div>
      {cells.map((cell, index) => (
        <div key={`${person}-${index}`} className={`h-6 rounded-md ${colors[cell]}`} />
      ))}
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-[3px] ${color}`} />
      {label}
    </span>
  );
}

function FacilityMockup() {
  const items = [
    ["INC-114 · Fall, witnessed — no injury", "State hotline notified 2h ago · investigation open · report PDF drafted", "Follow-up due 48h", "warn"],
    ["Fire drill — 2nd shift, east wing", "Evacuation 4m 12s · every §2600.132 field logged · PDF filed", "Complete", "success"],
    ["WO-58 · Generator monthly load test", "Vendor on-site Thu · fuel level recorded · photos attached", "Verify to close", "info"],
    ["POC · §2600.65(a) training citation", "Evidence attached for follow-up visit · Plan of Correction PDF generated", "POC submitted", "warn"],
  ];
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#dfe6ee] bg-white shadow-[0_10px_30px_rgba(13,39,66,0.07)]">
      <div className="flex flex-col gap-1 border-b border-[#e5eaf0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-bold">Open facility work — this week</span>
        <span className={`font-mono text-[11px] ${aaMutedText}`}>4 items · 1 needs verification</span>
      </div>
      {items.map(([title, detail, badge, tone]) => (
        <div key={title} className="flex flex-col gap-3 border-b border-[#eef2f6] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[13.5px] font-semibold">{title}</div>
            <div className={`text-xs ${aaMutedText}`}>{detail}</div>
          </div>
          <StatusBadge tone={tone}>{badge}</StatusBadge>
        </div>
      ))}
      <div className={`bg-[#fafbfc] px-4 py-3 text-xs ${aaMutedText}`}>
        Nothing closes without an owner, a deadline, and supervisor verification — a warning becomes completed work, not another unresolved alert.
      </div>
    </div>
  );
}

function EvidenceMockup() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#dfe6ee] bg-white shadow-[0_10px_30px_rgba(13,39,66,0.07)]">
      <div className="flex flex-col gap-1 border-b border-[#e5eaf0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-bold">Survey readiness — Maple Grove</span>
        <span className="rounded-full bg-[#eaf6ec] px-2.5 py-1 font-mono text-[11px] font-bold text-[#1e7a35]">Score 94 / 100</span>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-2.5">
          <div className={`font-mono text-[10.5px] uppercase tracking-[0.08em] ${aaMutedText}`}>Binder contents · live</div>
          {["Training compliance & certificates", "Credentials & clearances", "Medication practicums", "Resident assessments", "Incidents & plans of correction"].map((item) => (
            <div key={item} className="flex items-center gap-2 text-[13px]"><Check className="h-4 w-4 stroke-[3] text-[#1e7a35]" />{item}</div>
          ))}
          <div className="flex items-center gap-2 text-[13px]"><ArrowRight className="h-4 w-4 text-[#8a5a00]" /><span>Fire drills — <span className="font-semibold text-[#8a5a00]">1 sleeping-hours drill due</span></span></div>
        </div>
        <div className="flex flex-col gap-2.5">
          <div className={`font-mono text-[10.5px] uppercase tracking-[0.08em] ${aaMutedText}`}>Citation-weighted risk</div>
          <div className="text-[12.5px] text-[#44566b]">Topics surface in the order DHS actually cites them — the most-cited regulation your facility is exposed on appears first.</div>
          <span className="mt-auto rounded-lg bg-[#0d2742] px-3.5 py-2.5 text-center text-[13px] font-bold text-white">Generate binder PDF</span>
          <div className={`text-center text-[11.5px] ${aaMutedText}`}>Rebuilt from live records · delivered via short-lived secure link</div>
        </div>
      </div>
      <div className={`border-t border-[#eef2f6] bg-[#fafbfc] px-4 py-3 text-xs ${aaMutedText}`}>
        Auditors and surveyors get read-only, time-limited evidence rooms — never edit access, never the whole application.
      </div>
    </div>
  );
}

function StatusBadge({ tone, children }: { tone: string; children: ReactNode }) {
  const cls =
    tone === "success"
      ? "bg-[#eaf6ec] text-[#1e7a35]"
      : tone === "info"
        ? "bg-[#e5effa] text-[#14548f]"
        : "bg-[#fdf4e3] text-[#8a5a00]";
  return <span className={`self-start whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold ${cls}`}>{children}</span>;
}

/**
 * Animates the hero compliance badge from 0 to `target` on mount (cubic
 * ease-out, matching the design prototype). Renders `target` during SSR /
 * prerender and for visitors who prefer reduced motion, so the resting value
 * is always correct without JS.
 */
function useHeroCountUp(target: number) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    let tick = 0;
    setValue(0);
    const id = window.setInterval(() => {
      tick += 1;
      const next = Math.min(target, Math.round(target * (1 - Math.pow(1 - tick / 45, 3))));
      setValue(next);
      if (next >= target) window.clearInterval(id);
    }, 26);
    return () => window.clearInterval(id);
  }, [target]);
  return value;
}

export default function Landing() {
  usePageMeta({ ...MARKETING_ROUTE_META["/"], path: "/" });
  const [domainIndex, setDomainIndex] = useState(0);
  const activeDomain = DOMAINS[domainIndex];
  const heroScore = useHeroCountUp(94);

  return (
    <MarketingLayout>
      <section id="top" className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="relative mx-auto grid max-w-[1160px] grid-cols-1 items-center gap-12 px-6 pb-14 pt-[72px] lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.08] px-3.5 py-1.5 text-xs font-bold text-[#b9e4ff]">
                <span className="h-2 w-2 rounded-full bg-[#4ade80] shadow-[0_0_0_4px_rgba(74,222,128,0.16)]" />
                Built for Pennsylvania PCH & ALF operators
              </span>
            </Reveal>
            <h1 className="text-balance text-[clamp(2.75rem,8vw,3.625rem)] font-extrabold leading-[1.05] tracking-[-0.02em]">
              <span className="block">Run the facility. </span>
              <span className="block">See the risk. </span>
              <span className="block text-[#8ec8ff]">Prove the work.</span>
            </h1>
            <Reveal delay={0.08}>
              <p className="max-w-[34ch] text-[19px] leading-[1.5] text-white/85">
                Know you're survey-ready before the knock — without running your facility out of spreadsheets, binders, and one person's memory.
              </p>
            </Reveal>
            <Reveal delay={0.14} className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="bg-white font-bold text-[#0d2742] hover:bg-[#dcebfa]" data-testid="button-hero-signup">
                <Link href="/signup">Start a Free Trial</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/30 bg-white/[0.06] font-bold text-white hover:bg-white/15" data-testid="button-hero-demo">
                <Link href="/demo">Explore the live demo</Link>
              </Button>
            </Reveal>
            <Reveal delay={0.18}>
              <p className="text-[13px] text-white/75">Fully self-service — log into a sandbox or start your own {TRIAL_DAYS}-day trial, no phone call. <Link href="/how-it-works" className="font-semibold text-[#b9e4ff] hover:text-white hover:underline">See how it works →</Link></p>
            </Reveal>
          </div>

          <Reveal delay={0.16} className="relative">
            <div className="overflow-hidden rounded-[14px] bg-white text-[#1c2b3a] shadow-[0_30px_60px_rgba(0,0,0,0.4)]">
              <div className="flex items-center gap-1.5 border-b border-[#e5eaf0] bg-[#f6f8fa] px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#e4b1ab]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#e8d3a4]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#aed4b3]" />
                <span className={`ml-2 font-mono text-[10px] uppercase tracking-[0.06em] ${aaMutedText}`}>CareBase / Facility Command Center</span>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-[#e5eaf0] px-[18px] py-4">
                <div className="flex items-center gap-2.5">
                  <LogoMark className="h-9 w-9" />
                  <div>
                    <div className="text-[15px] font-bold">Sunrise Healthcare Group</div>
                    <div className={`font-mono text-[10px] ${aaMutedText}`}>4 facilities · 186 employees · binder ready</div>
                  </div>
                </div>
                <span className="rounded-full bg-[#eaf6ec] px-2.5 py-1 font-mono text-[11px] font-bold text-[#1e7a35]">{heroScore}% compliant</span>
              </div>
              <div className="space-y-3 px-[18px] py-4">
                {HERO_ROWS.map((row) => (
                  <div key={row.label}>
                    <div className="mb-1 flex justify-between gap-3 text-xs">
                      <span className="font-semibold">{row.label}</span>
                      <span className="font-mono text-[11px] text-[#1e7a35]">{row.status}</span>
                    </div>
                    <ProgressBar value={row.value} />
                  </div>
                ))}
                <div className="rounded-[10px] border border-[#f0d9a8] bg-[#fdf4e3] px-3 py-2.5">
                  <div className="mb-1 flex justify-between gap-3 text-xs">
                    <span className="font-bold text-[#8a5a00]">Expiring credentials</span>
                    <span className="font-mono text-[11px] font-bold text-[#8a5a00]">3 due in 21 days</span>
                  </div>
                  <ProgressBar value={74} amber />
                  <div className="mt-1.5 text-[11px] text-[#6d5312]">Act 34 clearance — J. Miller, R. Chen, T. Brooks · alert sent to facility manager</div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-4 -left-4 hidden rounded-[10px] border border-[#e5eaf0] bg-white px-3.5 py-2.5 text-[#1c2b3a] shadow-[0_14px_30px_rgba(0,0,0,0.3)] sm:block">
              <div className="text-xs font-bold text-[#0d2742]">Risk caught before survey day</div>
              <div className={`font-mono text-[10.5px] ${aaMutedText}`}>Retraining assigned · due Aug 2 · evidence attached</div>
            </div>
          </Reveal>
        </div>
        <Reveal className="relative mx-auto max-w-[1160px] px-6 pb-14">
          <div className="grid gap-6 border-t border-white/15 pt-6 sm:grid-cols-2 lg:grid-cols-4">
            {HERO_METRICS.map((metric) => (
              <div key={metric.value}>
                <div className="font-mono text-[22px] font-bold">{metric.value}</div>
                <div className="mt-1 text-[12.5px] leading-5 text-white/80">{metric.label}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[1160px] px-6 py-[72px]">
          <Reveal className="mx-auto flex max-w-[780px] flex-col gap-3.5 text-center">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">In plain English</p>
            <h2 className="text-balance text-3xl font-bold tracking-[-0.015em] text-[#0d2742] sm:text-4xl">One system that proves your facility is doing its job</h2>
            <p className="text-[16.5px] leading-[1.6] text-[#44566b]">CareBase tracks every training hour, credential, clearance, resident assessment, incident, and inspection your Pennsylvania license requires — assigns the work to the right person before it's late, and turns the proof into a binder your surveyor can't argue with.</p>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {PLAIN_ENGLISH.map((card, i) => (
              <Reveal key={card.number} delay={i * 0.05} className={`${cardClass} flex flex-col gap-2.5`}>
                <div className="font-serif text-[40px] font-extrabold leading-none text-[#4a7cab]">{card.number}</div>
                <div className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#1b6fc2]">{card.eyebrow}</div>
                <h3 className="text-[19px] font-bold text-[#0d2742]">{card.title}</h3>
                <p className="text-sm text-[#44566b]">{card.copy}</p>
                {card.href && card.link ? <Link href={card.href} className="mt-auto text-[13.5px] font-bold text-[#1b6fc2] hover:text-[#0d2742] hover:underline">{card.link}</Link> : null}
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[1160px] px-6 py-14">
          <Reveal>
            <h2 className="mb-5 text-center text-[28px] font-bold tracking-[-0.01em] text-[#0d2742]">Which facility do you run?</h2>
          </Reveal>
          <div className="grid gap-4 md:grid-cols-2">
            {PERSONAS.map((persona, i) => (
              <Reveal key={persona.title} delay={i * 0.06} className={`${cardClass} flex flex-col gap-3`}>
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[#1b6fc2]">{persona.chapter}</span>
                <h3 className="text-[21px] font-bold text-[#0d2742]">{persona.title}</h3>
                <p className="text-sm text-[#44566b]">{persona.copy}</p>
                <p className="text-sm text-[#44566b]"><strong className="text-[#0d2742]">{persona.warning.split(". ")[0]}.</strong> {persona.warning.split(". ").slice(1).join(". ")}</p>
                <div className="flex flex-wrap gap-2">
                  {persona.tags.map((tag) => <span key={tag} className="rounded-full bg-[#f0f5fa] px-3 py-1 text-xs font-semibold text-[#33465c]">{tag}</span>)}
                </div>
                <a href="#start" className="mt-auto self-start text-sm font-bold text-[#1b6fc2] hover:text-[#0d2742] hover:underline">{persona.cta}</a>
              </Reveal>
            ))}
          </div>
          <p className={`mx-auto mt-4 text-center text-[13px] ${aaMutedText}`}>Group home, nursing, home health, or hospice? The <Link href="/pa-training-requirements" className="font-medium text-[#1b6fc2] hover:underline">requirements guide</Link> covers your pathway too.</p>
        </div>
      </section>

      <section id="platform" className="scroll-mt-[72px] border-b border-[#e5eaf0] bg-[#f6f8fa]">
        <div className="mx-auto max-w-[1160px] px-6 py-[72px]">
          <Reveal className="max-w-[640px]">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">The whole facility, one record</p>
            <h2 className="mt-3 text-balance text-[34px] font-bold leading-tight tracking-[-0.015em] text-[#0d2742]">Stop being the person who remembers everything</h2>
            <p className="mt-3 text-[#44566b]">Residents, staff, the building, and the survey — every deadline on its own clock, every task owned, every completion leaving proof. Pick a domain to see the actual workflow.</p>
          </Reveal>
          <Reveal className="mt-7 flex flex-wrap gap-2">
            {DOMAINS.map((domain, index) => (
              <button
                key={domain.label}
                type="button"
                aria-pressed={domainIndex === index}
                onClick={() => setDomainIndex(index)}
                className={domainIndex === index ? "rounded-full border border-[#0d2742] bg-[#0d2742] px-4 py-2.5 text-sm font-bold text-white" : "rounded-full border border-[#c8d4e0] bg-white px-4 py-2.5 text-sm font-bold text-[#44566b] hover:border-[#0d2742]"}
              >
                {domain.label}
              </button>
            ))}
          </Reveal>
          <Reveal key={activeDomain.label} className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.9fr)]">
            {activeDomain.mockup}
            <div className="flex flex-col gap-2.5">
              <h3 className="text-lg font-extrabold text-[#0d2742]">{activeDomain.title}</h3>
              <p className="text-sm text-[#44566b]">{activeDomain.intro}</p>
              <div className="flex flex-wrap gap-2">
                {activeDomain.tags.map((tag) => <PillTag key={tag}>{tag}</PillTag>)}
              </div>
              <div className={`mt-1.5 border-l-[3px] border-[#d7dfe8] pl-3 text-[12.5px] ${aaMutedText}`}>{activeDomain.note}</div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-[#f6f8fa]">
        <div className="mx-auto max-w-[1160px] px-6 py-16">
          <Reveal>
            <h2 className="mb-7 text-center text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-[#0d2742]">Facilities don't fail surveys for lack of training.<br />They fail to find the proof.</h2>
          </Reveal>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {DIFF_ITEMS.map((item, i) => (
              <Reveal key={item.old} delay={i * 0.04} className="flex flex-col gap-2.5 rounded-xl border border-[#e5eaf0] p-[18px]">
                <div className="text-[13.5px] text-[#5d7084] line-through">{item.old}</div>
                <div className="text-sm font-bold text-[#0d2742]">{item.carebase}</div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[1160px] px-6 py-[72px]">
          <Reveal className="max-w-[640px]">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">What sets it apart</p>
            <h2 className="mt-2.5 text-balance text-[32px] font-bold leading-tight tracking-[-0.01em] text-[#0d2742]">Four things you won't find in a training portal</h2>
          </Reveal>
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            {DIFFERENTIATORS.map((item, i) => (
              <Reveal key={item.title} delay={(i % 2) * 0.06} className={`${cardClass} flex flex-col gap-3`}>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#dcebfa] text-[#1b6fc2]"><item.icon className="h-5 w-5" /></div>
                <h3 className="text-xl font-bold text-[#0d2742]">{item.title}</h3>
                {item.body.map((paragraph) => <p key={paragraph} className="text-sm text-[#44566b]">{paragraph}</p>)}
                <div className="mt-auto border-t border-[#eef2f6] pt-3 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[#1b6fc2]">{item.footer}</div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-r from-[#1b6fc2] to-[#143a5c] text-white">
        <div className="mx-auto flex max-w-[1160px] flex-col gap-5 px-6 py-9 sm:flex-row sm:items-center sm:justify-between">
          <Reveal>
            <h2 className="text-xl font-bold">Seen enough to be curious?</h2>
            <p className="mt-1 text-sm text-white/85">Import your roster this afternoon — the trial is self-serve and every module is included.</p>
          </Reveal>
          <Reveal className="flex flex-wrap gap-3">
            <Button asChild className="bg-white font-bold text-[#0d2742] hover:bg-[#dcebfa]"><Link href="/signup">Start free trial</Link></Button>
            <Button asChild variant="outline" className="border-white/45 bg-transparent font-bold text-white hover:bg-white/15"><Link href="/features">See all 50+ capabilities</Link></Button>
          </Reveal>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-[72px] border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[1160px] px-6 py-[72px]">
          <Reveal className="mx-auto max-w-[560px] text-center">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">Pricing</p>
            <h2 className="mt-2.5 text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-[#0d2742]">Priced per facility. Every module included.</h2>
            <p className="mt-2 text-[15px] text-[#44566b]">No per-seat math, no module upsells. Unlimited employees and residents on every plan.</p>
          </Reveal>
          <div className="mt-9 grid gap-4 lg:grid-cols-3">
            {PLANS.map((plan, i) => (
              <Reveal key={plan.name} delay={i * 0.05} className={`relative flex flex-col gap-3.5 rounded-[14px] p-6 ${plan.featured ? "border-2 border-[#1b6fc2] bg-white shadow-[0_16px_40px_rgba(27,111,194,0.12)]" : plan.tone === "muted" ? "border border-[#dfe6ee] bg-[#fafbfc]" : "border border-[#dfe6ee] bg-white"}`}>
                {plan.featured ? <span className="absolute -top-3 left-6 rounded-full bg-[#1b6fc2] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-white">Multi-site</span> : null}
                <h3 className="text-base font-extrabold text-[#0d2742]">{plan.name}</h3>
                <div><span className="text-[38px] font-extrabold tracking-[-0.02em] text-[#0d2742]">{plan.price}</span>{plan.suffix ? <span className={`text-sm ${aaMutedText}`}>{plan.suffix}</span> : null}</div>
                <div className="space-y-2">
                  {plan.features.map((feature) => <CheckLine key={feature}>{feature}</CheckLine>)}
                </div>
                <Button asChild className={plan.featured ? "mt-auto bg-[#1b6fc2] font-bold text-white hover:bg-[#14548f]" : "mt-auto border border-[#c8d4e0] bg-transparent font-bold text-[#0d2742] hover:bg-[#f0f5fa]"}>
                  <Link href={plan.href}>{plan.cta}</Link>
                </Button>
              </Reveal>
            ))}
          </div>
          <p className={`mx-auto mt-4 max-w-[640px] text-center text-[12.5px] ${aaMutedText}`}>These prices feed the <Link href="/savings" className="font-bold text-[#1b6fc2] hover:underline">savings worksheet below</Link> automatically — model your net opportunity with your own coordination hours and tool spend, risk avoidance excluded.</p>
        </div>
      </section>

      <section className="bg-[#071626] text-white">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 py-6 text-center text-[13.5px]">
          <span className="text-white/88">No guaranteed survey outcomes</span><span className="text-white/35">·</span>
          <span className="text-white/88">No per-seat fees</span><span className="text-white/35">·</span>
          <span className="text-white/88">Your data exports if you leave</span>
          <Link href="/how-it-works#promises" className="font-bold text-[#8ec8ff] hover:text-white hover:underline">Read our promises →</Link>
        </div>
      </section>

      <section id="start" className="scroll-mt-[72px] border-b border-[#e5eaf0] bg-[#f6f8fa]">
        <div className="mx-auto grid max-w-[1160px] gap-12 px-6 py-[72px] lg:grid-cols-2">
          <Reveal className="flex flex-col gap-3">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">Fully self-service</p>
            <h2 className="text-balance text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-[#0d2742]">Signup to survey-ready, without talking to anyone</h2>
            <p className="text-[15px] text-[#44566b]">No sales call. No onboarding call. No "book time with our team." Every module is live the moment your organization exists.</p>
            <div className="mt-2 space-y-2.5 text-[13.5px] text-[#33465c]">
              {START_STEPS.map(([title, detail], index) => (
                <div key={title} className="flex gap-2.5"><span className="font-extrabold text-[#1b6fc2]">{index + 1}</span><span><strong>{title}</strong> — {detail}</span></div>
              ))}
            </div>
            <p className={`mt-1.5 text-[13px] ${aaMutedText}`}>Stuck on something? <Link href="/faq" className="text-[#1b6fc2] hover:underline">The FAQ</Link> answers the common questions; <a href="mailto:hello@caremetric.ai" className="text-[#1b6fc2] hover:underline">hello@caremetric.ai</a> answers async — never a required call.</p>
          </Reveal>
          <Reveal delay={0.08} className="flex flex-col gap-4 rounded-[14px] border-2 border-[#1b6fc2] bg-white p-7 shadow-[0_16px_40px_rgba(27,111,194,0.12)]">
            <div className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#1b6fc2]">Start now — all you need</div>
            <div className="space-y-2 text-sm text-[#33465c]">
              <CheckLine>Your facility name and license type</CheckLine>
              <CheckLine>A work email for the admin account</CheckLine>
              <CheckLine>Optional: a roster CSV for bulk import</CheckLine>
            </div>
            <Button asChild size="lg" className="bg-[#1b6fc2] font-bold text-white hover:bg-[#14548f]"><Link href="/signup">Create your organization — free for {TRIAL_DAYS} days</Link></Button>
            <Link href="/demo" className="text-center text-[13px] font-semibold text-[#1b6fc2] hover:underline" data-testid="link-start-demo">Prefer to look around first? Explore the live demo — no signup needed →</Link>
            <div className={`text-center text-xs ${aaMutedText}`}>Every module included · unlimited staff · cancel in-app, export everything · <Link href="/privacy" className="text-[#1b6fc2] hover:underline">Privacy</Link></div>
          </Reveal>
        </div>
      </section>

      <section id="faq" className="scroll-mt-[72px] bg-white">
        <div className="mx-auto max-w-[780px] px-6 py-[72px]">
          <Reveal>
            <h2 className="mb-6 text-center text-[28px] font-extrabold tracking-[-0.02em] text-[#0d2742]">Straight answers</h2>
          </Reveal>
          <div className="space-y-2.5">
            {FAQS.map((faq, i) => (
              <Reveal key={faq.question} delay={i * 0.03} className="rounded-xl border border-[#e5eaf0] px-5 py-[18px]">
                <h3 className="text-[15px] font-extrabold text-[#0d2742]">{faq.question}</h3>
                <p className="mt-1.5 text-sm text-[#44566b]">{faq.answer}</p>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="mt-5 text-center text-sm"><Link href="/faq" className="font-bold text-[#1b6fc2] hover:underline">Read the full FAQ — 20+ answers →</Link></p>
          </Reveal>
        </div>
      </section>
    </MarketingLayout>
  );
}
