import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

const residentLifecycle = [
  {
    label: "01 — INQUIRY & ADMISSION",
    text: "Prospect tracking, preadmission RASP/ASP screening, room readiness, and the resident agreement — handled before move-in day.",
  },
  {
    label: "02 — FIRST 15 DAYS",
    text: "The initial assessment lands on its own regulatory clock, the support plan opens automatically, and orientation evidence attaches to the record.",
  },
  {
    label: "03 — EVERY DAY",
    text: "Services assigned and recorded — completed, refused, or escalated — plus dietary rounds, appointments, transportation, and routed medication events.",
  },
  {
    label: "04 — WHEN SOMETHING CHANGES",
    text: "A fall or hospital return routes provider notification, reassessment, support-plan review, and documented follow-up — no informal handoffs.",
  },
  {
    label: "05 — EVERY YEAR",
    text: "Annual reassessment is scheduled automatically — and completing it triggers the support-plan update Chapter 2600 and 2800 require.",
  },
  {
    label: "06 — MOVE-OUT",
    text: "Discharge documentation, financial closeout, and a retained record that still answers a surveyor's question months later.",
  },
];

const capabilityGroups = [
  {
    title: "TRAINING & COMPLIANCE CORE",
    items: [
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
    title: "AI & LIVE TRAINING",
    items: [
      "AI curriculum generation from your documents",
      "AI avatar video lessons",
      "Targeted block-level regeneration",
      "Live class scheduling & digital sign-in",
      "Rotating QR & kiosk PIN check-in",
      "Printable meeting notices with QR",
    ],
  },
  {
    title: "RESIDENT CARE & OPERATIONS",
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
    title: "SURVEY, SAFETY & FACILITY",
    items: [
      "One-click compliance binder PDF",
      "Citation-weighted readiness score",
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
    title: "CREDENTIALS & WORKFORCE",
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
    title: "ACCESS & ONBOARDING",
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
];

const roleCards = [
  {
    role: "Owner / executive",
    sees: "org-wide rollups, trends, and unresolved risk across every facility.",
    does: "compares facilities and reviews readiness before leadership or diligence questions arrive.",
  },
  {
    role: "Org admin",
    sees: "compliance across the whole organization, including resident assessments.",
    does: "configures rules, requirements, and access once for every facility.",
  },
  {
    role: "Facility manager",
    sees: "assigned sites only — overdue staff, open work, shift coverage.",
    does: "resolves gaps, approves work, validates outside training records.",
  },
  {
    role: "Trainer",
    sees: "class rosters, retraining queues, and course drafts.",
    does: "runs classes with QR check-in, drafts AI-assisted courses, manages practicum evidence.",
  },
  {
    role: "Employee",
    sees: "their own assignments, schedule, and certificates — never coworker data.",
    does: "completes training, signs policies, and uploads records from their phone.",
  },
  {
    role: "Auditor / surveyor",
    sees: "read-only evidence scoped to exactly what was requested.",
    does: "reviews the record without the ability to change anything.",
  },
];

export default function Features() {
  usePageMeta({ ...MARKETING_ROUTE_META["/features"], path: "/features" });

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
            padding: "56px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            alignItems: "center",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "42px",
              fontWeight: 700,
              letterSpacing: "-0.015em",
              lineHeight: 1.1,
              textWrap: "balance",
            }}
          >
            Everything CareBase does, in one place
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "16px",
              color: "rgba(255,255,255,0.85)",
              maxWidth: "56ch",
              textWrap: "pretty",
            }}
          >
            The complete capability index and the six roles that use it. Every plan includes all of it — no modules, no upsells, unlimited staff and residents.
          </p>
        </div>
      </section>

      <section style={{ background: "#071626", color: "#ffffff" }}>
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
            <div style={{ maxWidth: "640px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <span
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#8ec8ff",
                }}
              >
                The resident lifecycle
              </span>
              <h2 style={{ margin: 0, fontSize: "32px", fontWeight: 700, letterSpacing: "-0.01em", textWrap: "balance" }}>
                Every resident, managed from inquiry to move-out
              </h2>
              <p style={{ margin: 0, color: "rgba(255,255,255,0.82)", fontSize: "15px" }}>
                Staff compliance is half the job. The other half — assessments, support plans, daily services — is where surveyors spend their afternoon. Same record, same clocks.
              </p>
            </div>
            <div
              style={{
                marginTop: "32px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
                gap: "14px",
              }}
            >
              {residentLifecycle.map((item) => (
                <div
                  key={item.label}
                  style={{
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    borderRadius: "12px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", letterSpacing: "0.1em", color: "#8ec8ff" }}>
                    {item.label}
                  </div>
                  <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.55, color: "rgba(255,255,255,0.82)" }}>{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: "#f6f8fa", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "72px 24px" }}>
          <div style={{ textAlign: "center", maxWidth: "620px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#1b6fc2",
              }}
            >
              Everything included
            </span>
            <h2 style={{ margin: 0, fontSize: "32px", fontWeight: 700, letterSpacing: "-0.01em", color: "#0d2742" }}>
              50+ capabilities. One price. No module upsells.
            </h2>
            <p style={{ margin: 0, color: "#44566b", fontSize: "15px" }}>Every plan ships the complete platform — this is the full index.</p>
          </div>
          <div
            style={{
              marginTop: "36px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "14px",
              alignItems: "start",
            }}
          >
            {capabilityGroups.map((group) => (
              <div
                key={group.title}
                style={{
                  background: "#ffffff",
                  border: "1px solid #dfe6ee",
                  borderRadius: "12px",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "10.5px", fontWeight: 700, letterSpacing: "0.1em", color: "#5d7084" }}>
                  {group.title}
                </div>
                <div style={{ fontSize: "13px", color: "#33465c", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {group.items.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "72px 24px" }}>
          <div style={{ textAlign: "center", maxWidth: "620px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#1b6fc2",
              }}
            >
              Built for every role
            </span>
            <h2 style={{ margin: 0, fontSize: "32px", fontWeight: 700, letterSpacing: "-0.01em", color: "#0d2742" }}>
              Six roles, each scoped to exactly their job
            </h2>
            <p style={{ margin: 0, color: "#44566b", fontSize: "15px" }}>Access is enforced by database policy — not just hidden menus.</p>
          </div>
          <div style={{ marginTop: "36px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "14px" }}>
            {roleCards.map((card) => (
              <div
                key={card.role}
                style={{
                  background: "#ffffff",
                  border: "1px solid #dfe6ee",
                  borderRadius: "12px",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "15px", color: "#0d2742" }}>{card.role}</div>
                <div style={{ fontSize: "13px", color: "#44566b" }}>
                  <strong style={{ color: "#33465c" }}>Sees:</strong> {card.sees}
                </div>
                <div style={{ fontSize: "13px", color: "#44566b" }}>
                  <strong style={{ color: "#33465c" }}>Does:</strong> {card.does}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: "#071626", color: "#ffffff" }}>
        <div
          style={{
            maxWidth: "860px",
            margin: "0 auto",
            padding: "56px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.01em" }}>Every capability, from day one of the trial</h2>
          <p style={{ margin: 0, fontSize: "15px", color: "rgba(255,255,255,0.82)", maxWidth: "52ch" }}>
            Import your roster and see your own facility's compliance picture this week.
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
              style={{
                border: "1px solid rgba(255,255,255,0.3)",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: "14.5px",
                padding: "12px 20px",
                borderRadius: "9px",
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
