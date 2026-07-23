import { type CSSProperties, useMemo, useState } from "react";
import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import {
  CONTACT_EMAIL,
  GROWTH_PRICE,
  GROWTH_PRICE_MONTHLY,
  STARTER_PRICE,
  STARTER_PRICE_MONTHLY,
  TRIAL_DAYS,
} from "@/components/marketing/pricing";
import { usePageMeta } from "@/lib/usePageMeta";

type SavingsState = {
  hours: number;
  rate: number;
  tools: number;
  cut: number;
  fac: number;
};

type SliderKey = keyof SavingsState;

type SliderDefinition = {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  valueLabel: (value: number) => string;
  help: string;
};

const INITIAL_STATE: SavingsState = {
  hours: 10,
  rate: 35,
  tools: 400,
  cut: 25,
  fac: 2,
};

const sliders: SliderDefinition[] = [
  {
    key: "hours",
    label: "Weekly admin hours coordinating records",
    min: 1,
    max: 60,
    step: 1,
    valueLabel: (value) => `${value} hrs/wk`,
    help: "Chasing documents, reconciling training, copying deadlines, checking follow-up.",
  },
  {
    key: "rate",
    label: "Loaded hourly labor cost",
    min: 18,
    max: 80,
    step: 1,
    valueLabel: (value) => `$${value} /hr`,
    help: "Wage plus payroll burden and benefits.",
  },
  {
    key: "tools",
    label: "Monthly spend on tools you could retire",
    min: 0,
    max: 2000,
    step: 50,
    valueLabel: (value) => `$${value} /mo`,
    help: "Only software the comparison table above says CareBase truly replaces.",
  },
  {
    key: "cut",
    label: "Expected reduction in coordination time",
    min: 5,
    max: 60,
    step: 5,
    valueLabel: (value) => `${value}%`,
    help: `Keep it conservative — validate it during your ${TRIAL_DAYS}-day trial.`,
  },
  {
    key: "fac",
    label: "Facilities",
    min: 1,
    max: 20,
    step: 1,
    valueLabel: (value) => String(value),
    help: `Sets which per-facility rate applies from pricing (${STARTER_PRICE} single-facility, ${GROWTH_PRICE} organization).`,
  },
];

const educationCosts = [
  {
    title: "A per-seat LMS subscription",
    body: "Generic courses priced per employee per month — that still don't match your §2600 / §2800 topic list.",
  },
  {
    title: "Content libraries & repeat instructor fees",
    body: "Paying again every year for the same dementia, fire-safety, and abuse-reporting material.",
  },
  {
    title: "Admin hours nobody counts",
    body: "Re-typing sign-in sheets, chasing certificates, and rebuilding the binder before every visit.",
  },
];

const includedItems = [
  "Course builder with graded quizzes & certificates",
  "AI course creation from your own policies — human-approved before publishing",
  "Live classes with QR sign-in — hours log themselves",
  "Up to 6 on-the-job hours captured, the way §2600.65 allows",
  "Unlimited staff — no per-seat math, ever",
];

const comparisonRows = [
  [
    "Annual in-service hours",
    "Manual reconciliation, once a year",
    "Course completions only",
    "All sources — courses, live classes, outside records",
  ],
  ["Live class attendance", "Paper sign-in sheets", "—", "Rotating QR + kiosk PIN check-in"],
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
  ["Shift scheduling", "Whiteboard or spreadsheet", "—", "Auto-fill from each employee's typical pattern"],
  ["Survey binder", "A night of printing", "Partial export", "One-click PDF rebuilt from live records"],
  ["Auditor access", "Hand over the binder", "A shared login", "Read-only role + time-limited evidence rooms"],
];

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const pageGridStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  backgroundImage:
    "repeating-linear-gradient(to bottom, transparent, transparent 31px, rgba(255,255,255,0.05) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, rgba(255,255,255,0.05) 32px)",
};

const eyebrowStyle: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "#1b6fc2",
};

export default function Savings() {
  const [state, setState] = useState<SavingsState>(INITIAL_STATE);

  usePageMeta({ ...MARKETING_ROUTE_META["/savings"], path: "/savings" });

  const modeled = useMemo(() => {
    const { hours, rate, tools, cut, fac } = state;
    const labor = hours * 52 * rate;
    const toolY = tools * 12;
    const gross = (labor * cut) / 100 + toolY;
    const unit = fac >= 3 ? GROWTH_PRICE_MONTHLY : STARTER_PRICE_MONTHLY;
    const annualPrice = unit * 12 * fac;
    const net = gross - annualPrice;
    const payback = gross > 0 ? annualPrice / (gross / 12) : null;

    return {
      labor,
      toolY,
      gross,
      annualPrice,
      net,
      payback,
      planNote: fac >= 3 ? "organization rate" : "single-facility rate",
    };
  }, [state]);

  const setSlider = (key: SliderKey, value: string) => {
    setState((current) => ({ ...current, [key]: Number(value) }));
  };

  const emailHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    "CareBase savings model",
  )}&body=${encodeURIComponent(
    `Please send me the CareBase savings worksheet for ${state.fac} facilities. Current model: labor ${money(
      modeled.labor,
    )}/yr, tools ${money(modeled.toolY)}/yr, CareBase ${money(
      modeled.annualPrice,
    )}/yr, net ${modeled.net < 0 ? "−" : ""}${money(Math.abs(modeled.net))}.`,
  )}`;

  return (
    <MarketingLayout>
      <section
        data-screen-label="Hero"
        style={{
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, #071626 0%, #0d2742 55%, #143a5c 100%)",
          color: "#ffffff",
        }}
      >
        <div style={pageGridStyle} />
        <div
          style={{
            position: "relative",
            maxWidth: 860,
            margin: "0 auto",
            padding: "60px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 15,
            alignItems: "center",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.08)",
              borderRadius: 99,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              color: "#b9e4ff",
            }}
          >
            The business case
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: 42,
              fontWeight: 700,
              letterSpacing: "-0.015em",
              lineHeight: 1.1,
              textWrap: "balance",
            }}
          >
            Where the money comes from
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 16.5,
              color: "rgba(255,255,255,0.85)",
              maxWidth: "56ch",
              textWrap: "pretty",
            }}
          >
            Coordination labor you stop paying for, tools you retire, and an education line item you stop paying
            three times over. Model it with your own numbers — risk avoidance deliberately excluded.
          </p>
        </div>
      </section>

      <section data-screen-label="Education costs" style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "72px 24px" }}>
          <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={eyebrowStyle}>The education line item</span>
            <h2
              style={{
                margin: 0,
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "#0d2742",
                textWrap: "balance",
              }}
            >
              Stop paying three times for the same required training
            </h2>
            <p style={{ margin: 0, color: "#44566b", fontSize: 15, textWrap: "pretty" }}>
              The annual hours are mandatory. Most facilities pay for them at least three times over.
            </p>
          </div>
          <div
            style={{
              marginTop: 28,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
              gap: 16,
              alignItems: "stretch",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {educationCosts.map((item) => (
                <div key={item.title} style={{ border: "1px solid #e5eaf0", borderRadius: 12, padding: "18px 20px" }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14.5,
                      color: "#5d7084",
                      textDecoration: "line-through",
                    }}
                  >
                    {item.title}
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "#5d7084" }}>{item.body}</p>
                </div>
              ))}
            </div>
            <div
              style={{
                border: "2px solid #1b6fc2",
                background: "#f4f9fe",
                borderRadius: 14,
                padding: 26,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                boxShadow: "0 16px 40px rgba(27,111,194,0.1)",
              }}
            >
              <div
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: "#1b6fc2",
                }}
              >
                INCLUDED IN YOUR PER-FACILITY PRICE
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 14, color: "#33465c" }}>
                {includedItems.map((item) => (
                  <div key={item} style={{ display: "flex", gap: 9 }}>
                    <span style={{ color: "#1e7a35", fontWeight: 800 }}>✓</span>
                    {item}
                  </div>
                ))}
              </div>
              <a href="#savings" style={{ marginTop: "auto", alignSelf: "flex-start", fontWeight: 700, fontSize: 14 }}>
                Model your own numbers below ↓
              </a>
            </div>
          </div>
        </div>
      </section>

      <section data-screen-label="Comparison" style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "72px 24px" }}>
          <div
            style={{
              textAlign: "center",
              maxWidth: 640,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span style={eyebrowStyle}>An honest comparison</span>
            <h2 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-0.01em", color: "#0d2742" }}>
              Compared with what you're using now
            </h2>
            <p style={{ margin: 0, color: "#44566b", fontSize: 15 }}>
              If you only need course delivery, a basic LMS is cheaper. CareBase is for operators who need the whole
              record to agree.
            </p>
          </div>
          <div
            style={{
              marginTop: 32,
              border: "1px solid #dfe6ee",
              borderRadius: 14,
              overflowX: "auto",
              boxShadow: "0 10px 30px rgba(13,39,66,0.05)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr 1.25fr", fontSize: 13, minWidth: 720 }}>
              {[
                "",
                "SPREADSHEETS & BINDERS",
                "TRAINING-ONLY LMS",
                "CAREBASE",
              ].map((heading, index) => (
                <div
                  key={heading || "blank"}
                  style={{
                    padding: index === 3 ? "13px 18px 13px 14px" : index === 0 ? "13px 18px" : "13px 14px",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 10.5,
                    letterSpacing: "0.08em",
                    color: index === 3 ? "#0d2742" : "#5d7084",
                    fontWeight: index === 3 ? 700 : undefined,
                    background: index === 3 ? "#eaf3fc" : "#fafbfc",
                    borderBottom: index === 3 ? "1px solid #cfe2f4" : "1px solid #e5eaf0",
                  }}
                >
                  {heading}
                </div>
              ))}
              {comparisonRows.map((row, rowIndex) =>
                row.map((cell, cellIndex) => {
                  const isLastRow = rowIndex === comparisonRows.length - 1;
                  const isCareBase = cellIndex === 3;
                  return (
                    <div
                      key={`${row[0]}-${cellIndex}`}
                      style={{
                        padding: cellIndex === 0 ? "12px 18px" : isCareBase ? "12px 18px 12px 14px" : "12px 14px",
                        borderBottom: isLastRow ? undefined : isCareBase ? "1px solid #dcebf8" : "1px solid #eef2f6",
                        background: isCareBase ? "#f3f9fe" : undefined,
                        color: cellIndex === 0 || isCareBase ? "#0d2742" : "#5d7084",
                        fontWeight: cellIndex === 0 ? 700 : isCareBase ? 600 : undefined,
                      }}
                    >
                      {cell}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </section>

      <section
        id="savings"
        data-screen-label="Savings worksheet"
        style={{ scrollMarginTop: 72, background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}
      >
        <div
          style={{
            maxWidth: 1160,
            margin: "0 auto",
            padding: "72px 24px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
            gap: 48,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={eyebrowStyle}>Model your savings</span>
            <h2
              style={{
                margin: 0,
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "#0d2742",
                textWrap: "balance",
              }}
            >
              Build the case with your own numbers
            </h2>
            <p style={{ margin: 0, color: "#44566b", fontSize: 15 }}>
              Starting values are an illustration, not a customer result. Risk avoidance — citations, penalties,
              turnover — is deliberately excluded.
            </p>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 20 }}>
              {sliders.map((slider) => (
                <label
                  key={slider.key}
                  style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 13.5, fontWeight: 700, color: "#33465c" }}
                >
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <span>{slider.label}</span>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#1b6fc2" }}>
                      {slider.valueLabel(state[slider.key])}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={slider.min}
                    max={slider.max}
                    step={slider.step}
                    value={state[slider.key]}
                    onChange={(event) => setSlider(slider.key, event.currentTarget.value)}
                    style={{ accentColor: "#1b6fc2", width: "100%" }}
                  />
                  <span style={{ fontWeight: 400, fontSize: 12, color: "#5d7084" }}>{slider.help}</span>
                </label>
              ))}
            </div>
          </div>

          <div
            style={{
              background: "#0d2742",
              color: "#ffffff",
              borderRadius: 14,
              padding: 28,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              boxShadow: "0 20px 50px rgba(13,39,66,0.25)",
              position: "sticky",
              top: 88,
            }}
            aria-live="polite"
          >
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.1em", color: "#8ec8ff" }}>
              MODELED ANNUAL OPPORTUNITY
            </div>
            {[
              ["Current coordination labor", `${money(modeled.labor)} /yr`],
              ["Replaceable tool spend", `${money(modeled.toolY)} /yr`],
              [
                <>
                  CareBase at your size <span style={{ color: "rgba(255,255,255,0.55)" }}>({modeled.planNote})</span>
                </>,
                `${money(modeled.annualPrice)} /yr`,
              ],
            ].map(([label, value], index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  fontSize: 13.5,
                  borderBottom: "1px solid rgba(255,255,255,0.14)",
                  paddingBottom: 10,
                }}
              >
                <span style={{ color: "rgba(255,255,255,0.78)" }}>{label}</span>
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{value}</span>
              </div>
            ))}
            <div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>Gross opportunity before CareBase</div>
              <div
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 36,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  color: "#8ec8ff",
                }}
              >
                {money(modeled.gross)}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.65)" }}>Net after CareBase</div>
                <div
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 20,
                    fontWeight: 700,
                    color: modeled.net >= 0 ? "#8fd9a0" : "#f2a9a0",
                  }}
                >
                  {modeled.net < 0 ? "−" : ""}
                  {money(Math.abs(modeled.net))}
                </div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.65)" }}>Modeled payback</div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 20, fontWeight: 700 }}>
                  {modeled.payback === null ? "—" : `${Math.round(modeled.payback * 10) / 10} mo`}
                </div>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "rgba(255,255,255,0.6)" }}>
              Applies your chosen reduction to labor only and assumes the tool spend is fully removable. A planning
              estimate — not a quote or a guarantee.
            </p>
            <a
              href="/#start"
              className="hover:bg-[#dcebfa] hover:no-underline"
              style={{
                textAlign: "center",
                background: "#ffffff",
                color: "#0d2742",
                fontWeight: 700,
                fontSize: 14,
                padding: "11px 16px",
                borderRadius: 9,
                textDecoration: "none",
              }}
            >
              Verify these numbers in your trial
            </a>
            <a
              href={emailHref}
              className="hover:no-underline hover:bg-[rgba(255,255,255,0.2)]"
              style={{
                textAlign: "center",
                background: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.25)",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: 13,
                padding: "10px 14px",
                borderRadius: 8,
                textDecoration: "none",
              }}
            >
              Email my model
            </a>
          </div>
        </div>
      </section>

      <section data-screen-label="CTA" style={{ background: "#071626", color: "#ffffff" }}>
        <div
          style={{
            maxWidth: 860,
            margin: "0 auto",
            padding: "56px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>
            Test the model on your own facility
          </h2>
          <p style={{ margin: 0, fontSize: 15, color: "rgba(255,255,255,0.82)", maxWidth: "52ch" }}>
            Run the trial for {TRIAL_DAYS} days and compare the worksheet against reality — no call required to start,
            no call required to cancel.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
            <a
              href="/#pricing"
              className="hover:bg-[#dcebfa] hover:no-underline"
              style={{
                background: "#ffffff",
                color: "#0d2742",
                fontWeight: 700,
                fontSize: 14.5,
                padding: "12px 20px",
                borderRadius: 9,
                textDecoration: "none",
              }}
            >
              Start a free trial
            </a>
            <Link
              href="/faq"
              className="hover:bg-[rgba(255,255,255,0.12)] hover:no-underline"
              style={{
                border: "1px solid rgba(255,255,255,0.3)",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: 14.5,
                padding: "12px 20px",
                borderRadius: 9,
                textDecoration: "none",
              }}
            >
              Questions? Read the FAQ
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
