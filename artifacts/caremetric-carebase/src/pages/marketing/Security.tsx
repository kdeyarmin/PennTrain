import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

const securityControls = [
  {
    title: "Row-level security by design",
    text: "Organization, facility, role, and record-scope rules are enforced by Postgres Row-Level Security at the database boundary — not just in the interface.",
  },
  {
    title: "Six enforced access levels",
    text: "Platform admin, org admin, facility manager, trainer, employee, and auditor — each scoped to exactly the data their role should touch.",
  },
  {
    title: "Private storage, signed URLs",
    text: "Documents, certificates, sign-in sheets, and binders live in private storage, accessed only through short-lived signed links.",
  },
  {
    title: "Immutable audit trail",
    text: "Compliance-determining actions — quiz grading, certificate issuance, course publishing — are logged and can't be altered after the fact.",
  },
  {
    title: "Human review gate on AI content",
    text: "AI-touched training content can't publish until a named reviewer signs off — and the approval clears automatically the moment any block is regenerated.",
  },
  {
    title: "Audited support impersonation",
    text: "Support sign-in-as-user requires a written reason, can't target another admin or a deactivated account, and every session start and end is immutably logged.",
  },
  {
    title: "Version-bound e-signature evidence",
    text: "Policy attestations capture the signer, timestamp, IP, user agent, and a content hash of the exact document version reviewed — designed to support ESIGN/UETA recordkeeping.",
  },
  {
    title: "Hashed, never-plaintext secrets",
    text: "Class check-in PINs are bcrypt-hashed at rest and verified inside the database — the plaintext value is never stored.",
  },
];

const testQuestions = [
  "Can a facility manager only reach assigned-facility records — and does an out-of-scope facility show \"Not Assigned,\" never a false all-clear?",
  "Can an employee see their own training without seeing coworker credentials?",
  "Can an auditor review evidence without the ability to change it?",
  "Can support impersonation, AI review, certificate issuance, and policy signatures be audited afterward?",
];

const diligenceAreas = [
  {
    title: "Identity & access",
    text: "Role permissions, org and facility scope, employee self-service boundaries, MFA support, and auditor read-only behavior.",
  },
  {
    title: "Evidence & file handling",
    text: "Private storage, short-lived access links, controlled evidence sharing, record ownership, and file access boundaries.",
  },
  {
    title: "Operational controls",
    text: "Database-enforced policies, approval and review gates, audit events, support access, and out-of-scope facility behavior.",
  },
  {
    title: "Deployment & contract",
    text: "Hosting responsibility, backups, recovery, retention and deletion, incident response, subprocessors, and any required agreement or certification.",
  },
];

export default function Security() {
  usePageMeta({ ...MARKETING_ROUTE_META["/security"], path: "/security" });

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
            padding: "64px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
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
            Security & trust
          </span>
          <h1 style={{ margin: 0, fontSize: "42px", fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.1, textWrap: "balance" }}>
            Security controls you can verify in the product
          </h1>
          <p style={{ margin: 0, fontSize: "17px", color: "rgba(255,255,255,0.85)", maxWidth: "54ch", textWrap: "pretty" }}>
            Your residents' and staff's records are safer here than in a filing cabinet or a shared drive: every boundary is enforced at the database, every sensitive action is logged, and every claim below is something you can test yourself in the free trial.
          </p>
        </div>
      </section>

      <section style={{ background: "#071626", color: "#ffffff", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "56px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            {securityControls.map((control) => (
              <div key={control.title} style={{ border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.055)", borderRadius: "12px", padding: "22px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px", color: "#b9e4ff" }}>{control.title}</div>
                <p style={{ margin: "8px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: "rgba(255,255,255,0.8)" }}>{control.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>
        <div
          style={{
            maxWidth: "1160px",
            margin: "0 auto",
            padding: "64px 24px",
            display: "grid",
            gridTemplateColumns: "0.9fr 1.1fr",
            gap: "40px",
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#1b6fc2" }}>
              Test it yourself
            </span>
            <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.01em", color: "#0d2742", textWrap: "balance" }}>
              Four things to test in any system — ours included
            </h2>
            <p style={{ margin: 0, fontSize: "14.5px", color: "#44566b" }}>Trust claims should translate into access behavior you can watch happen.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {testQuestions.map((question) => (
              <div key={question} style={{ border: "1px solid #dfe6ee", borderRadius: "12px", padding: "14px 18px", fontSize: "14px", color: "#33465c" }}>
                {question}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: "#f6f8fa", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "64px 24px" }}>
          <div style={{ maxWidth: "640px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#1b6fc2" }}>
              Buyer due diligence
            </span>
            <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.01em", color: "#0d2742" }}>
              Evaluate product controls and deployment obligations separately
            </h2>
          </div>
          <div style={{ marginTop: "24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            {diligenceAreas.map((area) => (
              <div key={area.title} style={{ background: "#ffffff", border: "1px solid #dfe6ee", borderRadius: "12px", padding: "20px" }}>
                <div style={{ fontWeight: 700, fontSize: "14.5px", color: "#0d2742" }}>{area.title}</div>
                <p style={{ margin: "8px 0 0", fontSize: "13.5px", color: "#44566b" }}>{area.text}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "18px", border: "1px solid #f0d9a8", background: "#fdf7ea", borderRadius: "10px", padding: "14px 18px", fontSize: "13px", color: "#6d5312" }}>
            These product controls are not, by themselves, a claim of a particular certification, a signed business associate agreement, or compliance for every deployment. Confirm the hosted environment, contract, retention requirements, and organizational safeguards that apply to your use.
          </div>
        </div>
      </section>

      <section style={{ background: "#071626", color: "#ffffff" }}>
        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "56px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "14px", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.01em" }}>Give your security reviewer their own login</h2>
          <p style={{ margin: 0, fontSize: "15px", color: "rgba(255,255,255,0.82)", maxWidth: "52ch" }}>
            Create a trial organization and let them probe every boundary themselves. Hosting and contract documentation is available for download.
          </p>
          <a
            href="/#start"
            className="hover:bg-[#dcebfa] hover:no-underline"
            style={{ background: "#ffffff", color: "#0d2742", fontWeight: 700, fontSize: "14.5px", padding: "12px 20px", borderRadius: "9px", textDecoration: "none", marginTop: "6px" }}
          >
            Start the free trial
          </a>
        </div>
      </section>
    </MarketingLayout>
  );
}
