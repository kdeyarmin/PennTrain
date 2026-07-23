import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

const howSteps = [
  {
    title: "Configure the operation",
    text: "Add facilities, roles, residents, and employees. Import your roster by CSV. Set the training, credential, and alert rules that apply.",
    note: "A PCH direct care worker automatically gets the 12-hour §2600.65 bucket.",
  },
  {
    title: "Route the work",
    text: "Training, resident services, schedules, incident follow-up, and approvals go to the person responsible — each with an owner and a deadline.",
    note: "A hospital return opens notification, reassessment, and plan-review tasks.",
  },
  {
    title: "Capture proof as it happens",
    text: "Completions, signatures, uploads, sign-ins, and audit events attach to the right employee, resident, requirement, and date.",
    note: "A QR class check-in becomes logged in-service hours instantly.",
  },
  {
    title: "See risk, share evidence",
    text: "Dashboards and escalating alerts surface gaps early. Binders and evidence rooms answer leadership, auditors, and surveyors.",
    note: "The binder PDF rebuilds from live records in one click.",
  },
];

const switchingPoints = [
  {
    title: "An afternoon, not a project.",
    text: "CSV import brings your whole roster in; your binder stays untouched while you ramp.",
  },
  {
    title: "Staff need only a browser.",
    text: "QR check-in from their own phones, a phone-installable training player — no app store, no IT.",
  },
  {
    title: "Run both for month one.",
    text: "Keep the paper binder alongside until CareBase has earned your trust.",
  },
  {
    title: "Your data leaves with you.",
    text: "Export everything if you cancel — records are yours, not hostages.",
  },
];

const weekCards = [
  {
    day: "MONDAY",
    text: "A new aide is hired. Her 12-hour §2600.65 plan, orientation checklist, Act 34 countdown, and TB screen are assigned before lunch — nobody built a spreadsheet row.",
  },
  {
    day: "TUESDAY",
    text: "Mr. Alvarez returns from the hospital. Provider notification, reassessment, and support-plan review open automatically, each with an owner and a clock.",
  },
  {
    day: "WEDNESDAY",
    text: "Dementia in-service, 2 p.m. Staff scan the rotating QR at the door; the hours land on each record the moment they sign in. No paper sheet to file.",
  },
  {
    day: "THURSDAY",
    text: "Second-shift fire drill, east wing. Logged from a phone during the drill — evacuation time, every §2600.132 field, PDF filed before the shift ends.",
  },
  {
    day: "FRIDAY",
    text: "Corporate asks how the facility looks. You export the binder PDF from live records and go home on time. That's the product.",
  },
];

const promiseCards = [
  {
    title: "We don't replace your eMAR, EHR, or payroll.",
    text: "CareBase runs the coordination layer around them — and routes medication events from your external source instead of pretending to administer them.",
  },
  {
    title: "We don't guarantee a deficiency-free survey.",
    text: "We make requirements, deadlines, ownership, and evidence visible so your team closes gaps before the surveyor finds them.",
  },
  {
    title: "We don't quote a universal ROI.",
    text: "You model savings with your own hours, labor cost, and tool spend — risk avoidance deliberately excluded.",
  },
];

export default function HowItWorks() {
  usePageMeta({ ...MARKETING_ROUTE_META["/how-it-works"], path: "/how-it-works" });

  return (
    <MarketingLayout>
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, #071626 0%, #0d2742 55%, #143a5c 100%)",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent, transparent 31px, rgba(255,255,255,0.05) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, rgba(255,255,255,0.05) 32px)",
          }}
        />
        <div
          style={{
            position: "relative",
            maxWidth: "860px",
            margin: "0 auto",
            padding: "60px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: "15px",
            alignItems: "center",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.08)",
              borderRadius: "99px",
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 700,
              color: "#b9e4ff",
            }}
          >
            How it works
          </span>
          <h1 style={{ margin: 0, fontSize: "42px", fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.1, textWrap: "balance" }}>
            From spreadsheet chaos to survey-ready
          </h1>
          <p style={{ margin: 0, fontSize: "16.5px", color: "rgba(255,255,255,0.85)", maxWidth: "56ch", textWrap: "pretty" }}>
            The four moves every module follows, what switching actually takes, and what a normal week looks like once CareBase is running your facility.
          </p>
        </div>
      </section>

      <section id="how" style={{ scrollMarginTop: "72px", background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "72px 24px" }}>
          <div style={{ textAlign: "center", maxWidth: "620px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#1b6fc2" }}>
              How it works
            </span>
            <h2 style={{ margin: 0, fontSize: "32px", fontWeight: 700, letterSpacing: "-0.01em", color: "#0d2742", textWrap: "balance" }}>
              Set it up once. It nags so you don't have to.
            </h2>
            <p style={{ margin: 0, color: "#44566b", fontSize: "15px" }}>
              Every module — training, residents, incidents, maintenance — follows the same four moves, so staff learn it once.
            </p>
          </div>
          <div
            style={{
              marginTop: "36px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
              gap: "14px",
            }}
          >
            {howSteps.map((step, index) => (
              <div key={step.title} style={{ border: "1px solid #e5eaf0", borderRadius: "12px", padding: "22px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <span
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "99px",
                    background: "#0d2742",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: "14px",
                    fontWeight: 700,
                  }}
                >
                  {index + 1}
                </span>
                <div style={{ fontWeight: 700, fontSize: "15.5px", color: "#0d2742" }}>{step.title}</div>
                <p style={{ margin: 0, fontSize: "13.5px", color: "#44566b" }}>{step.text}</p>
                <div style={{ marginTop: "auto", fontSize: "12px", color: "#5d7084", borderTop: "1px solid #eef2f6", paddingTop: "10px" }}>{step.note}</div>
              </div>
            ))}
          </div>
          <p style={{ margin: "20px auto 0", textAlign: "center", fontSize: "13px", color: "#5d7084" }}>
            Setup is self-serve — most single facilities are entering real records the same day.
          </p>

          <div style={{ marginTop: "40px", border: "1px solid #dfe6ee", background: "#f6f8fa", borderRadius: "14px", padding: "26px" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: "20px", fontWeight: 700, color: "#0d2742", textAlign: "center" }}>Switching without the drama</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "14px" }}>
              {switchingPoints.map((point) => (
                <div key={point.title} style={{ display: "flex", gap: "10px", fontSize: "13.5px", color: "#33465c" }}>
                  <span style={{ color: "#1e7a35", fontWeight: 800 }}>✓</span>
                  <span>
                    <strong>{point.title}</strong> {point.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "64px 24px" }}>
          <div style={{ textAlign: "center", maxWidth: "620px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#1b6fc2" }}>
              A week with CareBase
            </span>
            <h2 style={{ margin: 0, fontSize: "30px", fontWeight: 700, letterSpacing: "-0.01em", color: "#0d2742" }}>What actually changes, day by day</h2>
          </div>
          <div style={{ marginTop: "32px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: "12px" }}>
            {weekCards.map((card) => (
              <div key={card.day} style={{ border: "1px solid #dfe6ee", borderRadius: "12px", padding: "18px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "#1b6fc2" }}>{card.day}</div>
                <p style={{ margin: 0, fontSize: "13.5px", color: "#33465c" }}>{card.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="promises" style={{ scrollMarginTop: "72px", background: "#071626", color: "#ffffff" }}>
        <div style={{ position: "relative", overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "repeating-linear-gradient(to bottom, transparent, transparent 31px, rgba(255,255,255,0.05) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, rgba(255,255,255,0.05) 32px)",
            }}
          />
          <div style={{ position: "relative", maxWidth: "1160px", margin: "0 auto", padding: "72px 24px" }}>
            <div style={{ maxWidth: "620px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8ec8ff" }}>
                Why operators trust us
              </span>
              <h2 style={{ margin: 0, fontSize: "30px", fontWeight: 800, letterSpacing: "-0.02em", textWrap: "balance" }}>Our promises are unusually specific</h2>
              <p style={{ margin: 0, color: "rgba(255,255,255,0.82)", fontSize: "15px" }}>
                Compliance software is full of guarantees nobody can keep. We'd rather tell you the boundaries.
              </p>
            </div>
            <div style={{ marginTop: "28px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "14px" }}>
              {promiseCards.map((card) => (
                <div key={card.title} style={{ border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", borderRadius: "12px", padding: "20px" }}>
                  <div style={{ fontWeight: 800, fontSize: "15px", color: "#b9e4ff" }}>{card.title}</div>
                  <p style={{ margin: "8px 0 0", fontSize: "13.5px", lineHeight: 1.55, color: "rgba(255,255,255,0.8)" }}>{card.text}</p>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "20px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: "14px", alignItems: "stretch" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ border: "1px dashed rgba(255,255,255,0.3)", borderRadius: "12px", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "6px", justifyContent: "center" }}>
                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>[ operator quote — real testimonial, name, title, facility ]</div>
                  <div style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.75)" }}>This space stays empty until it's real. No invented customers.</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", fontSize: "12.5px" }}>
                  <div style={{ border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 14px", color: "rgba(255,255,255,0.85)" }}>
                    <strong style={{ color: "#b9e4ff" }}>Real binder DNA.</strong> The 60+ forms are adapted from an actual PA survey-readiness binder, not invented.
                  </div>
                  <div style={{ border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 14px", color: "rgba(255,255,255,0.85)" }}>
                    <strong style={{ color: "#b9e4ff" }}>Citation-weighted.</strong> Readiness scoring is ranked by what DHS actually cites, not a generic checklist.
                  </div>
                  <div style={{ border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 14px", color: "rgba(255,255,255,0.85)" }}>
                    <strong style={{ color: "#b9e4ff" }}>People you can call.</strong>{" "}
                    <Link href="/about" style={{ color: "#b9e4ff" }}>
                      Meet the team
                    </Link>{" "}
                    — one inbox, answered by the builders.
                  </div>
                </div>
              </div>
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: "12px",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  justifyContent: "center",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: "15px" }}>Founding-partner pricing for early operators</div>
                <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.8)" }}>
                  Early PCH and ALF operators get locked-in pricing and a direct line to the builders — the product shapes itself around your real workflows.
                </div>
                <a
                  href="/#start"
                  className="hover:bg-[#dcebfa] hover:no-underline"
                  style={{ alignSelf: "flex-start", background: "#ffffff", color: "#0d2742", fontWeight: 700, fontSize: "13.5px", padding: "9px 16px", borderRadius: "8px", textDecoration: "none" }}
                >
                  Become a founding partner
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: "#071626", color: "#ffffff" }}>
        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "56px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "14px", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.01em" }}>See it run your own workflows</h2>
          <p style={{ margin: 0, fontSize: "15px", color: "rgba(255,255,255,0.82)", maxWidth: "52ch" }}>
            Self-serve trial with every module included — signup to first binder without a single phone call.
          </p>
          <div style={{ display: "flex", gap: "12px", marginTop: "6px", flexWrap: "wrap", justifyContent: "center" }}>
            <a
              href="/#pricing"
              className="hover:bg-[#dcebfa] hover:no-underline"
              style={{ background: "#ffffff", color: "#0d2742", fontWeight: 700, fontSize: "14.5px", padding: "12px 20px", borderRadius: "9px", textDecoration: "none" }}
            >
              Start a free trial
            </a>
            <Link
              href="/faq"
              className="hover:bg-[rgba(255,255,255,0.12)] hover:no-underline"
              style={{ border: "1px solid rgba(255,255,255,0.3)", color: "#ffffff", fontWeight: 700, fontSize: "14.5px", padding: "12px 20px", borderRadius: "9px", textDecoration: "none" }}
            >
              Questions? Read the FAQ
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
