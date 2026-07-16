import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Layers3,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import {
  calculateSavingsModel,
  type SavingsInputs,
} from "@/lib/savingsModel";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

const REPLACEMENT_AREAS = [
  {
    title: "Training and workforce compliance",
    replaces:
      "A basic LMS, course-authoring tool, annual-hours spreadsheet, credential tracker, practicum log, live-class sign-in sheets, and policy acknowledgment tracker.",
    boundary:
      "Keep any outside accredited or approved course provider your rules still require; CareBase can retain its completion evidence.",
  },
  {
    title: "Survey evidence and corrective action",
    replaces:
      "Paper compliance binders, shared-drive evidence folders, survey-readiness spreadsheets, incident logs, complaint trackers, violation and POC sheets, and QAPI workbooks.",
    boundary:
      "CareBase organizes and shares evidence; it does not guarantee a deficiency-free survey or replace regulatory and legal judgment.",
  },
  {
    title: "Resident and facility operations",
    replaces:
      "Admissions and census trackers, assessment due-date calendars, resident-service task sheets, change-of-condition follow-up logs, dietary rounds, resident calendars, emergency logs, and maintenance work-order sheets.",
    boundary:
      "CareBase is not an EHR, clinical chart, emergency-call system, or eMAR. Medication events come from the external medication source.",
  },
  {
    title: "Basic scheduling and financial logs",
    replaces:
      "A standalone shift-planning spreadsheet plus basic resident rate, receivable, statement, and personal-funds ledgers.",
    boundary:
      "The schedule is not a payroll or timeclock system. Resident finance is an operational subledger with exports, not a general ledger, claims, or billing platform.",
  },
] as const;

const SAVINGS_LEVERS = [
  {
    icon: Clock3,
    title: "Reclaim coordination time",
    description:
      "Reduce the hours managers spend chasing documents, reconciling training, copying deadlines between sheets, preparing packets, and checking whether follow-up happened.",
  },
  {
    icon: Layers3,
    title: "Consolidate point tools",
    description:
      "Retire only the tools CareBase truly replaces, then keep eMAR, clinical, payroll, HRIS, and accounting systems connected where they remain authoritative.",
  },
  {
    icon: ShieldCheck,
    title: "Find risk earlier",
    description:
      "Use alerts, work queues, approvals, crosswalks, and readiness views to expose missing evidence before a survey or deadline. Risk avoidance is valuable, but intentionally excluded from the calculator below.",
  },
] as const;

const INITIAL_INPUTS: SavingsInputs = {
  weeklyCoordinationHours: 10,
  annualBinderHours: 40,
  loadedHourlyRate: 35,
  monthlyReplaceableToolSpend: 400,
  expectedLaborReductionPercent: 25,
  annualCareBasePrice: 0,
};

const FIELD_DEFINITIONS: {
  key: keyof SavingsInputs;
  label: string;
  help: string;
  suffix?: string;
}[] = [
  {
    key: "weeklyCoordinationHours",
    label: "Weekly admin hours spent coordinating records",
    help: "Chasing, reconciling, copying, filing, and status checking across the team.",
    suffix: "hours/week",
  },
  {
    key: "annualBinderHours",
    label: "Annual survey and binder preparation time",
    help: "One-time packet assembly, document cleanup, and evidence requests.",
    suffix: "hours/year",
  },
  {
    key: "loadedHourlyRate",
    label: "Loaded hourly labor cost",
    help: "Wage plus the payroll burden and benefits you use for internal planning.",
    suffix: "$/hour",
  },
  {
    key: "monthlyReplaceableToolSpend",
    label: "Monthly spend on tools you can actually retire",
    help: "Count only software or services covered by the replacement boundaries above.",
    suffix: "$/month",
  },
  {
    key: "expectedLaborReductionPercent",
    label: "Expected reduction in coordination time",
    help: "Use a conservative assumption and validate it during a workflow demo.",
    suffix: "%",
  },
  {
    key: "annualCareBasePrice",
    label: "Annual CareBase price",
    help: "Enter your quote to see a net estimate; leave at zero for gross opportunity only.",
    suffix: "$/year",
  },
];

type RawSavingsInputs = Record<keyof SavingsInputs, string>;

const INITIAL_RAW_INPUTS: RawSavingsInputs = {
  weeklyCoordinationHours: String(INITIAL_INPUTS.weeklyCoordinationHours),
  annualBinderHours: String(INITIAL_INPUTS.annualBinderHours),
  loadedHourlyRate: String(INITIAL_INPUTS.loadedHourlyRate),
  monthlyReplaceableToolSpend: String(INITIAL_INPUTS.monthlyReplaceableToolSpend),
  expectedLaborReductionPercent: String(INITIAL_INPUTS.expectedLaborReductionPercent),
  annualCareBasePrice: String(INITIAL_INPUTS.annualCareBasePrice),
};

const FIELD_MIN = 0;

const fieldMax = (key: keyof SavingsInputs): number =>
  key === "expectedLaborReductionPercent" ? 100 : Number.POSITIVE_INFINITY;

/**
 * Numeric interpretation of a raw field value, clamped to the field's
 * min/max — mirrors the clamping calculateSavingsModel applies so the
 * displayed inputs and the modeled results can never diverge.
 */
const clampFieldValue = (key: keyof SavingsInputs, raw: string): number => {
  const parsed = Number(raw);
  const numeric =
    raw.trim() === "" || !Number.isFinite(parsed) ? FIELD_MIN : parsed;
  return Math.min(fieldMax(key), Math.max(FIELD_MIN, numeric));
};

const toModelInputs = (raw: RawSavingsInputs): SavingsInputs => ({
  weeklyCoordinationHours: clampFieldValue(
    "weeklyCoordinationHours",
    raw.weeklyCoordinationHours,
  ),
  annualBinderHours: clampFieldValue("annualBinderHours", raw.annualBinderHours),
  loadedHourlyRate: clampFieldValue("loadedHourlyRate", raw.loadedHourlyRate),
  monthlyReplaceableToolSpend: clampFieldValue(
    "monthlyReplaceableToolSpend",
    raw.monthlyReplaceableToolSpend,
  ),
  expectedLaborReductionPercent: clampFieldValue(
    "expectedLaborReductionPercent",
    raw.expectedLaborReductionPercent,
  ),
  annualCareBasePrice: clampFieldValue(
    "annualCareBasePrice",
    raw.annualCareBasePrice,
  ),
});

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

const decimal = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

export default function Savings() {
  const [rawInputs, setRawInputs] = useState<RawSavingsInputs>(INITIAL_RAW_INPUTS);
  const result = calculateSavingsModel(toModelInputs(rawInputs));

  usePageMeta({ ...MARKETING_ROUTE_META["/savings"], path: "/savings" });

  const setInput = (key: keyof SavingsInputs, value: string) => {
    setRawInputs((current) => ({ ...current, [key]: value }));
  };

  const clampInput = (key: keyof SavingsInputs) => {
    setRawInputs((current) => ({
      ...current,
      [key]: String(clampFieldValue(key, current[key])),
    }));
  };

  return (
    <MarketingLayout>
      <PageHero
        eyebrow="Value, replacement, and boundaries"
        title="Know what CareBase replaces—and build the savings case with your own numbers"
        subtitle="Consolidate the operational tools and manual trackers CareBase actually covers, keep clinical and financial systems where they remain authoritative, and model the opportunity without relying on a generic ROI promise."
        highlights={[
          "Editable assumptions",
          "Explicit system boundaries",
          "Risk avoidance excluded from the model",
        ]}
      />

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <Layers3 className="h-6 w-6 text-primary" />
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
              Replace the coordination layer, not the systems that deliver clinical care
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              CareBase is the operating and compliance record around staff, residents, facilities,
              work, deadlines, and evidence. These boundaries make the consolidation story clear.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {REPLACEMENT_AREAS.map((area, index) => (
              <Reveal key={area.title} delay={(index % 2) * 0.06}>
                <Card className="h-full border-border/60 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">{area.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-0 text-sm leading-6">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <div>
                        <p className="font-semibold text-foreground">Can consolidate</p>
                        <p className="mt-1 text-muted-foreground">{area.replaces}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 rounded-xl bg-muted/45 p-4">
                      <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-semibold text-foreground">Keep this boundary</p>
                        <p className="mt-1 text-muted-foreground">{area.boundary}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <Reveal className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-primary shadow-sm">
              <CircleDollarSign className="h-3.5 w-3.5" />
              Where value comes from
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
              Three savings levers you can verify during a demo
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {SAVINGS_LEVERS.map((lever, index) => (
              <Reveal key={lever.title} delay={index * 0.06}>
                <Card className="h-full border-border/60 p-6 shadow-sm">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                    <lever.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold">{lever.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {lever.description}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-primary shadow-sm">
              <Calculator className="h-3.5 w-3.5" />
              Editable savings worksheet
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
              Model your addressable cost, then subtract the actual quote
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The starting values are an illustration, not a customer result. Replace every field
              with your organization's numbers and keep the expected time reduction conservative.
            </p>

            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {FIELD_DEFINITIONS.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <div className="relative">
                    <Input
                      id={field.key}
                      type="number"
                      min={0}
                      max={field.key === "expectedLaborReductionPercent" ? 100 : undefined}
                      step={field.key === "expectedLaborReductionPercent" ? 1 : 0.5}
                      value={rawInputs[field.key]}
                      onChange={(event) => setInput(field.key, event.target.value)}
                      onBlur={() => clampInput(field.key)}
                      aria-describedby={
                        field.suffix
                          ? `${field.key}-suffix ${field.key}-help`
                          : `${field.key}-help`
                      }
                      className="pr-24"
                    />
                    <span
                      id={`${field.key}-suffix`}
                      className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
                    >
                      {field.suffix}
                    </span>
                  </div>
                  <p id={`${field.key}-help`} className="text-xs leading-5 text-muted-foreground">
                    {field.help}
                    {field.key === "annualCareBasePrice" && (
                      <>
                        {" "}
                        <Link
                          href="/request-demo"
                          className="font-medium text-primary hover:underline"
                        >
                          Request a quote
                        </Link>
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <Card className="border-primary/25 bg-primary/[0.035] shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Modeled annual opportunity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4" aria-live="polite">
                {[
                  ["Current coordination labor", money.format(result.annualLaborCost)],
                  ["Current replaceable tool spend", money.format(result.annualReplaceableToolSpend)],
                  ["Current addressable cost", money.format(result.currentAddressableCost)],
                  ["Modeled labor opportunity", money.format(result.modeledLaborOpportunity)],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border/60 pb-3 text-sm last:border-0 last:pb-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="min-w-0 break-all text-right font-mono font-semibold tabular-nums">{value}</span>
                  </div>
                ))}

                <div className="rounded-2xl bg-background p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Gross opportunity before CareBase price
                  </p>
                  <p className="mt-2 break-all font-mono text-3xl font-bold tabular-nums text-primary">
                    {money.format(result.grossAnnualOpportunity)}
                  </p>
                  <p className="mt-4 text-xs leading-5 text-muted-foreground">
                    {result.netAnnualOpportunity === null
                      ? "Enter an annual CareBase price to calculate a net estimate."
                      : `Net modeled opportunity after CareBase: ${money.format(result.netAnnualOpportunity)}.`}
                  </p>
                </div>

                {result.modeledRoiPercent !== null && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border bg-background p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Modeled first-year ROI
                      </p>
                      <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
                        {percent.format(result.modeledRoiPercent / 100)}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Net modeled opportunity divided by annual price.
                      </p>
                    </div>
                    <div className="rounded-xl border bg-background p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Modeled payback
                      </p>
                      <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
                        {result.modeledPaybackMonths === null
                          ? "Not reached"
                          : `${decimal.format(result.modeledPaybackMonths)} months`}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Annual price divided by gross modeled opportunity.
                      </p>
                    </div>
                  </div>
                )}

                <p className="text-xs leading-5 text-muted-foreground">
                  This model applies your chosen reduction only to labor and assumes the tool spend
                  entered is fully removable. It excludes turnover, overtime, citations, penalties,
                  survey outcomes, and other risk avoidance. Results are planning estimates, not a guarantee.
                </p>
              </CardContent>
            </Card>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <Reveal>
          <Link
            href="/features"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Verify each replacement against the full feature list
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </section>

      <CtaBanner
        title="Build the savings case from your real workflow"
        subtitle="Bring your current trackers, software list, and survey-prep process. We'll map what CareBase can consolidate and what should stay connected."
      />
    </MarketingLayout>
  );
}
