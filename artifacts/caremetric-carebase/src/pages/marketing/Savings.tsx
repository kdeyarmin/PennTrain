import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { useEmailSavingsModel } from "@/hooks/useEmailSavingsModel";
import { useToast } from "@/hooks/use-toast";
import { usePageMeta } from "@/lib/usePageMeta";

const STARTER_PRICE = 349;
const GROWTH_PRICE = 299;

const EDUCATION_COSTS = [
  {
    title: "A per-seat LMS subscription",
    description:
      "Generic courses priced per employee per month — that still don't match your §2600 / §2800 topic list.",
  },
  {
    title: "Content libraries & repeat instructor fees",
    description:
      "Paying again every year for the same dementia, fire-safety, and abuse-reporting material.",
  },
  {
    title: "Admin hours nobody counts",
    description:
      "Re-typing sign-in sheets, chasing certificates, and rebuilding the binder before every visit.",
  },
] as const;

const INCLUDED_FEATURES = [
  "Course builder with graded quizzes & certificates",
  "AI course creation from your own policies — human-approved before publishing",
  "Live classes with QR sign-in — hours log themselves",
  "Up to 6 on-the-job hours captured, the way §2600.65 allows",
  "Unlimited staff — no per-seat math, ever",
] as const;

const COMPARISON_ROWS = [
  [
    "Annual in-service hours",
    "Manual reconciliation, once a year",
    "Course completions only",
    "All sources — courses, live classes, outside records",
  ],
  [
    "Live class attendance",
    "Paper sign-in sheets",
    "—",
    "Rotating QR + kiosk PIN check-in",
  ],
  [
    "Credentials & clearances",
    "A separate spreadsheet",
    "—",
    "Act 34/73/33, licenses, TB — with expirations & evidence",
  ],
  [
    "Resident assessments",
    "Wall calendar & memory",
    "—",
    "RASP/ASP on their own due-date clocks + drafting tool",
  ],
  [
    "Incidents & corrections",
    "Word docs in a folder",
    "—",
    "Notification clocks + generated incident & POC PDFs",
  ],
  [
    "Shift scheduling",
    "Whiteboard or spreadsheet",
    "—",
    "Auto-fill from each employee's typical pattern",
  ],
  [
    "Survey binder",
    "A night of printing",
    "Partial export",
    "One-click PDF rebuilt from live records",
  ],
  [
    "Auditor access",
    "Hand over the binder",
    "A shared login",
    "Read-only role + time-limited evidence rooms",
  ],
] as const;

const SLIDERS = [
  {
    key: "hours",
    label: "Weekly admin hours coordinating records",
    min: 1,
    max: 60,
    step: 1,
    valueLabel: (value: number) => `${value} hrs/wk`,
    help: "Chasing documents, reconciling training, copying deadlines, checking follow-up.",
  },
  {
    key: "rate",
    label: "Loaded hourly labor cost",
    min: 18,
    max: 80,
    step: 1,
    valueLabel: (value: number) => `$${value} /hr`,
    help: "Wage plus payroll burden and benefits.",
  },
  {
    key: "tools",
    label: "Monthly spend on tools you could retire",
    min: 0,
    max: 2000,
    step: 50,
    valueLabel: (value: number) => `$${value} /mo`,
    help: "Only software the comparison table above says CareBase truly replaces.",
  },
  {
    key: "cut",
    label: "Expected reduction in coordination time",
    min: 5,
    max: 60,
    step: 5,
    valueLabel: (value: number) => `${value}%`,
    help: "Keep it conservative — validate it during your trial month.",
  },
  {
    key: "fac",
    label: "Facilities",
    min: 1,
    max: 20,
    step: 1,
    valueLabel: (value: number) => String(value),
    help: "Sets which per-facility rate applies from the pricing above.",
  },
] as const;

type SliderKey = (typeof SLIDERS)[number]["key"];

type CalculatorState = Record<SliderKey, number>;

const INITIAL_CALCULATOR: CalculatorState = {
  hours: 10,
  rate: 35,
  tools: 400,
  cut: 25,
  fac: 2,
};

const money = (value: number) =>
  `$${Math.round(value).toLocaleString("en-US")}`;

export default function Savings() {
  const [calculator, setCalculator] =
    useState<CalculatorState>(INITIAL_CALCULATOR);
  const [modelSent, setModelSent] = useState(false);
  const [modelEmail, setModelEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as
    | string
    | undefined;
  const { toast } = useToast();
  const { mutate: emailModel, isPending: isEmailing } = useEmailSavingsModel();

  usePageMeta({ ...MARKETING_ROUTE_META["/savings"], path: "/savings" });

  const labor = calculator.hours * 52 * calculator.rate;
  const toolSpend = calculator.tools * 12;
  const gross = (labor * calculator.cut) / 100 + toolSpend;
  const unitPrice = calculator.fac >= 3 ? GROWTH_PRICE : STARTER_PRICE;
  const annualPrice = unitPrice * 12 * calculator.fac;
  const net = gross - annualPrice;
  const payback = gross > 0 ? annualPrice / (gross / 12) : null;

  const updateCalculator = (key: SliderKey, value: string) => {
    setCalculator((current) => ({ ...current, [key]: Number(value) }));
  };

  // Explicit-render Turnstile lifecycle, matching RequestDemo.tsx / Signup.tsx — the global
  // `window.turnstile` typing is declared in Signup.tsx.
  useEffect(() => {
    if (!turnstileSiteKey) return;
    let cancelled = false;

    const renderTurnstile = () => {
      if (
        cancelled ||
        !window.turnstile ||
        !turnstileContainerRef.current ||
        turnstileWidgetIdRef.current
      )
        return;
      turnstileWidgetIdRef.current = window.turnstile.render(
        turnstileContainerRef.current,
        {
          sitekey: turnstileSiteKey,
          callback: (token) => {
            setTurnstileToken(token);
            setTurnstileError(null);
          },
          "expired-callback": () => {
            setTurnstileToken("");
            setTurnstileError("Verification expired. Please complete it again.");
          },
          "error-callback": () => {
            setTurnstileToken("");
            setTurnstileError(
              "Verification could not load. Refresh the page or email us instead.",
            );
          },
        },
      );
    };

    if (window.turnstile) {
      renderTurnstile();
    } else {
      const scriptId = "cloudflare-turnstile-api";
      let script = document.getElementById(scriptId) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.id = scriptId;
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderTurnstile);
      const handleScriptError = () =>
        setTurnstileError(
          "Verification could not load. Check your connection and refresh the page.",
        );
      script.addEventListener("error", handleScriptError);
      return () => {
        cancelled = true;
        script?.removeEventListener("load", renderTurnstile);
        script?.removeEventListener("error", handleScriptError);
        if (turnstileWidgetIdRef.current)
          window.turnstile?.remove?.(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = null;
      };
    }

    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current)
        window.turnstile?.remove?.(turnstileWidgetIdRef.current);
      turnstileWidgetIdRef.current = null;
    };
  }, [turnstileSiteKey]);

  const resetTurnstile = () => {
    if (turnstileWidgetIdRef.current)
      window.turnstile?.reset(turnstileWidgetIdRef.current);
    setTurnstileToken("");
  };

  const handleEmailModel = (event: React.FormEvent) => {
    event.preventDefault();
    if (!modelEmail.trim()) return;
    if (!turnstileToken) {
      setTurnstileError("Please complete the verification first.");
      return;
    }
    emailModel(
      {
        email: modelEmail.trim(),
        hours: calculator.hours,
        rate: calculator.rate,
        tools: calculator.tools,
        cut: calculator.cut,
        fac: calculator.fac,
        turnstileToken,
      },
      {
        onSuccess: () => setModelSent(true),
        onError: (error) => {
          resetTurnstile();
          toast({
            variant: "destructive",
            title: "Could not send your savings model",
            description:
              error instanceof Error && error.message
                ? error.message
                : "Something went wrong. Try again, or email hello@caremetric.ai.",
          });
        },
      },
    );
  };

  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="relative mx-auto flex max-w-[860px] flex-col items-center gap-[15px] px-6 py-[60px] text-center">
          <span className="inline-flex rounded-full border border-white/20 bg-white/[0.08] px-3.5 py-1.5 text-xs font-bold text-[#b9e4ff]">
            The business case
          </span>
          <h1 className="m-0 text-balance text-[42px] font-bold leading-[1.1] tracking-[-0.015em] max-sm:text-4xl">
            Where the money comes from
          </h1>
          <p className="m-0 max-w-[56ch] text-pretty text-[16.5px] text-white/85">
            Coordination labor you stop paying for, tools you retire, and an
            education line item you stop paying three times over. Model it with
            your own numbers — risk avoidance deliberately excluded.
          </p>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[1160px] px-6 py-[72px]">
          <Reveal className="flex max-w-[680px] flex-col gap-2.5">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">
              The education line item
            </span>
            <h2 className="m-0 text-balance text-[32px] font-bold leading-tight tracking-[-0.01em] text-[#0d2742]">
              Stop paying three times for the same required training
            </h2>
            <p className="m-0 text-pretty text-[15px] text-[#44566b]">
              The annual hours are mandatory. Most facilities pay for them at
              least three times over.
            </p>
          </Reveal>

          <div className="mt-7 grid items-stretch gap-4 lg:grid-cols-2">
            <Reveal className="flex flex-col gap-2.5">
              {EDUCATION_COSTS.map((item) => (
                <article
                  key={item.title}
                  className="rounded-xl border border-[#e5eaf0] px-5 py-[18px]"
                >
                  <h3 className="text-[14.5px] font-bold text-[#5d7084] line-through">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-[13.5px] text-[#5d7084]">
                    {item.description}
                  </p>
                </article>
              ))}
            </Reveal>

            <Reveal
              delay={0.08}
              className="flex flex-col gap-3 rounded-[14px] border-2 border-[#1b6fc2] bg-[#f4f9fe] p-[26px] shadow-[0_16px_40px_rgba(27,111,194,0.10)]"
            >
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#1b6fc2]">
                Included in your per-facility price
              </span>
              <div className="flex flex-col gap-2.5 text-sm text-[#33465c]">
                {INCLUDED_FEATURES.map((feature) => (
                  <div key={feature} className="flex gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1e7a35]" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
              <a
                href="#savings"
                className="mt-auto self-start text-sm font-bold text-[#1b6fc2] hover:text-[#0d2742] hover:underline"
              >
                Model your own numbers below ↓
              </a>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[1160px] px-6 py-[72px]">
          <Reveal className="mx-auto flex max-w-[640px] flex-col gap-2.5 text-center">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">
              An honest comparison
            </span>
            <h2 className="m-0 text-[32px] font-bold leading-tight tracking-[-0.01em] text-[#0d2742]">
              Compared with what you're using now
            </h2>
            <p className="m-0 text-[15px] text-[#44566b]">
              If you only need course delivery, a basic LMS is cheaper. CareBase
              is for operators who need the whole record to agree.
            </p>
          </Reveal>

          <Reveal className="mt-8 overflow-x-auto rounded-[14px] border border-[#dfe6ee] shadow-[0_10px_30px_rgba(13,39,66,0.05)]">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#5d7084]">
                  <th className="border-b border-[#e5eaf0] bg-[#fafbfc] px-[18px] py-[13px] font-normal">
                    <span className="sr-only">Capability</span>
                  </th>
                  <th className="border-b border-[#e5eaf0] bg-[#fafbfc] px-3.5 py-[13px] font-normal">
                    Spreadsheets & binders
                  </th>
                  <th className="border-b border-[#e5eaf0] bg-[#fafbfc] px-3.5 py-[13px] font-normal">
                    Training-only LMS
                  </th>
                  <th className="border-b border-[#cfe2f4] bg-[#eaf3fc] px-[18px] py-[13px] font-bold text-[#0d2742]">
                    CareBase
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, index) => {
                  const isLast = index === COMPARISON_ROWS.length - 1;
                  return (
                    <tr key={row[0]}>
                      <th
                        scope="row"
                        className={`px-[18px] py-3 font-bold text-[#0d2742] ${
                          isLast ? "" : "border-b border-[#eef2f6]"
                        }`}
                      >
                        {row[0]}
                      </th>
                      <td
                        className={`px-3.5 py-3 text-[#5d7084] ${
                          isLast ? "" : "border-b border-[#eef2f6]"
                        }`}
                      >
                        {row[1]}
                      </td>
                      <td
                        className={`px-3.5 py-3 text-[#5d7084] ${
                          isLast ? "" : "border-b border-[#eef2f6]"
                        }`}
                      >
                        {row[2]}
                      </td>
                      <td
                        className={`bg-[#f3f9fe] px-[18px] py-3 font-semibold text-[#0d2742] ${
                          isLast ? "" : "border-b border-[#dcebf8]"
                        }`}
                      >
                        {row[3]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Reveal>
        </div>
      </section>

      <section
        id="savings"
        className="scroll-mt-[72px] border-b border-[#e5eaf0] bg-white"
      >
        <div className="mx-auto grid max-w-[1160px] items-start gap-12 px-6 py-[72px] lg:grid-cols-2">
          <Reveal className="flex flex-col gap-3">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">
              Model your savings
            </span>
            <h2 className="m-0 text-balance text-[32px] font-bold leading-tight tracking-[-0.01em] text-[#0d2742]">
              Build the case with your own numbers
            </h2>
            <p className="m-0 text-[15px] text-[#44566b]">
              Starting values are an illustration, not a customer result. Risk
              avoidance — citations, penalties, turnover — is deliberately
              excluded.
            </p>

            <div className="mt-3.5 flex flex-col gap-5">
              {SLIDERS.map((slider) => (
                <div key={slider.key} className="flex flex-col gap-[7px]">
                  <label
                    htmlFor={`savings-${slider.key}`}
                    className="flex items-baseline justify-between gap-3 text-[13.5px] font-bold text-[#33465c]"
                  >
                    <span>{slider.label}</span>
                    <span className="shrink-0 font-mono text-[13px] text-[#1b6fc2]">
                      {slider.valueLabel(calculator[slider.key])}
                    </span>
                  </label>
                  <input
                    id={`savings-${slider.key}`}
                    type="range"
                    min={slider.min}
                    max={slider.max}
                    step={slider.step}
                    value={calculator[slider.key]}
                    onChange={(event) =>
                      updateCalculator(slider.key, event.target.value)
                    }
                    aria-describedby={`savings-${slider.key}-help`}
                    className="w-full accent-[#1b6fc2]"
                  />
                  <span
                    id={`savings-${slider.key}-help`}
                    className="text-xs font-normal text-[#5d7084]"
                  >
                    {slider.help}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal
            delay={0.08}
            className="sticky top-[88px] flex flex-col gap-3.5 rounded-[14px] bg-[#0d2742] p-7 text-white shadow-[0_20px_50px_rgba(13,39,66,0.25)] max-lg:static"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#8ec8ff]">
              Modeled annual opportunity
            </span>
            {[
              ["Current coordination labor", `${money(labor)} /yr`],
              ["Replaceable tool spend", `${money(toolSpend)} /yr`],
              [
                <>
                  CareBase at your size{" "}
                  <span className="text-white/60">
                    (
                    {calculator.fac >= 3
                      ? "organization rate"
                      : "single-facility rate"}
                    )
                  </span>
                </>,
                `${money(annualPrice)} /yr`,
              ],
            ].map(([label, value], index) => (
              <div
                key={index}
                className="flex justify-between gap-3 border-b border-white/15 pb-2.5 text-[13.5px]"
              >
                <span className="text-white/80">{label}</span>
                <span className="break-all text-right font-mono font-semibold">
                  {value}
                </span>
              </div>
            ))}

            <div>
              <div className="text-[12.5px] text-white/70">
                Gross opportunity before CareBase
              </div>
              <div className="break-all font-mono text-4xl font-bold tracking-[-0.01em] text-[#8ec8ff]">
                {money(gross)}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[10px] border border-white/15 bg-white/[0.07] p-3.5">
                <div className="text-[11.5px] text-white/70">
                  Net after CareBase
                </div>
                <div
                  className={`break-all font-mono text-xl font-bold ${
                    net >= 0 ? "text-[#8fd9a0]" : "text-[#f2a9a0]"
                  }`}
                >
                  {net < 0 ? "−" : ""}
                  {money(Math.abs(net))}
                </div>
              </div>
              <div className="rounded-[10px] border border-white/15 bg-white/[0.07] p-3.5">
                <div className="text-[11.5px] text-white/70">
                  Modeled payback
                </div>
                <div className="font-mono text-xl font-bold">
                  {payback === null ? "—" : `${Math.round(payback * 10) / 10} mo`}
                </div>
              </div>
            </div>

            <p className="m-0 text-[11.5px] leading-normal text-white/65">
              Applies your chosen reduction to labor only and assumes the tool
              spend is fully removable. A planning estimate — not a quote or a
              guarantee.
            </p>
            <Button
              asChild
              className="bg-white font-bold text-[#0d2742] hover:bg-[#dcebfa]"
            >
              <Link href="/signup">Verify these numbers in your trial</Link>
            </Button>

            {modelSent ? (
              <div className="text-center text-[13px] font-semibold text-[#8fd9a0]">
                ✓ Sent — check your inbox for the worksheet with these numbers.
              </div>
            ) : turnstileSiteKey ? (
              <form className="flex flex-col gap-2" onSubmit={handleEmailModel}>
                <label htmlFor="savings-model-email" className="sr-only">
                  Email address for your savings model
                </label>
                <input
                  id="savings-model-email"
                  type="email"
                  required
                  value={modelEmail}
                  onChange={(event) => setModelEmail(event.target.value)}
                  placeholder="you@yourfacility.com"
                  className="min-w-0 flex-1 rounded-lg border border-white/25 bg-white/10 px-3 py-2.5 text-[13px] text-white placeholder:text-white/55"
                />
                <div ref={turnstileContainerRef} />
                {turnstileError && (
                  <p className="text-[12px] text-[#f2a9a0]" role="alert">
                    {turnstileError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={isEmailing || !turnstileToken}
                  className="whitespace-nowrap rounded-lg border border-white/25 bg-white/[0.14] px-3.5 py-2.5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isEmailing ? "Sending…" : "Email my model"}
                </button>
              </form>
            ) : (
              <p className="text-[12px] leading-5 text-white/70">
                Emailing the worksheet isn&apos;t configured for this deployment.{" "}
                <Link
                  href="/signup"
                  className="font-semibold text-[#8ec8ff] hover:underline"
                >
                  Start a free trial
                </Link>{" "}
                to verify these numbers on your own facility.
              </p>
            )}
          </Reveal>
        </div>
      </section>

      <section className="bg-[#071626] text-white">
        <div className="mx-auto flex max-w-[860px] flex-col items-center gap-3.5 px-6 py-14 text-center">
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.01em]">
            Test the model on your own facility
          </h2>
          <p className="m-0 max-w-[52ch] text-[15px] text-white/85">
            Run the trial for a month and compare the worksheet against reality
            — no call required to start, no call required to cancel.
          </p>
          <div className="mt-1.5 flex flex-wrap justify-center gap-3">
            <Button
              asChild
              className="bg-white px-5 py-3 text-[14.5px] font-bold text-[#0d2742] hover:bg-[#dcebfa]"
            >
              <Link href="/signup">Start a free trial</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="border-white/30 px-5 py-3 text-[14.5px] font-bold text-white hover:bg-white/10"
            >
              <Link href="/faq">
                Questions? Read the FAQ <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
