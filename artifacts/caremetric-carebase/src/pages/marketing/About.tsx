import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { CONTACT_EMAIL } from "@/components/marketing/pricing";
import { usePageMeta } from "@/lib/usePageMeta";

function PhotoPlaceholder() {
  return (
    <div
      style={{
        width: "96px",
        height: "96px",
        border: "1px dashed #b9c6d4",
        borderRadius: "9999px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#8a99a8",
        fontSize: "12px",
        fontWeight: "700",
        background: "#fafbfc",
      }}
    >
      Photo
    </div>
  );
}

export default function About() {
  usePageMeta({ ...MARKETING_ROUTE_META["/about"], path: "/about" });

  return (
    <MarketingLayout>
      <section style={{ position: "relative", overflow: "hidden", background: "linear-gradient(135deg, #071626 0%, #0d2742 55%, #143a5c 100%)", color: "#ffffff" }}>
        <div style={{ position: "absolute", inset: "0", backgroundImage: "repeating-linear-gradient(to bottom, transparent, transparent 31px, rgba(255,255,255,0.05) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, rgba(255,255,255,0.05) 32px)" }} />
        <div style={{ position: "relative", maxWidth: "860px", margin: "0 auto", padding: "64px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
          <span style={{ display: "inline-flex", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", borderRadius: "99px", padding: "6px 14px", fontSize: "12px", fontWeight: "700", color: "#b9e4ff" }}>About CareMetric CareBase</span>
          <h1 style={{ margin: "0", fontSize: "42px", fontWeight: "700", letterSpacing: "-0.015em", lineHeight: "1.1", textWrap: "balance" }}>Built in Pennsylvania, with the operators who run these buildings</h1>
          <p style={{ margin: "0", fontSize: "17px", color: "rgba(255,255,255,0.85)", maxWidth: "54ch", textWrap: "pretty" }}>CareBase exists because survey prep shouldn't be a night of printing and hole-punching — and because compliance software shouldn't overpromise.</p>
        </div>
      </section>

      <section style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", padding: "64px 24px", display: "flex", flexDirection: "column", gap: "18px" }}>
          <h2 style={{ margin: "0", fontSize: "28px", fontWeight: "700", color: "#0d2742" }}>Why we're building this</h2>
          <p style={{ margin: "0", fontSize: "15.5px", color: "#33465c", textWrap: "pretty" }}>Most personal care homes don't fail surveys because staff never learned the material. They struggle because the proof lives in paper sign-in sheets, old PDFs, email attachments, and a spreadsheet only one person understands. When the surveyor arrives, the work was done — but the evidence can't be found.</p>
          <p style={{ margin: "0", fontSize: "15.5px", color: "#33465c", textWrap: "pretty" }}>CareBase is our answer: one operational record where training, credentials, resident assessments, incidents, drills, maintenance, and scheduling all attach their own evidence as the work happens. The binder becomes an export, not a project.</p>
          <p style={{ margin: "0", fontSize: "15.5px", color: "#33465c", textWrap: "pretty" }}>We build it against the actual regulations — 55 Pa. Code Chapters 2600 and 2800 first — and we prove it in real Pennsylvania facilities every day. CareBase is part of the CareMetric family of care-operations products.</p>
        </div>
      </section>

      <section style={{ background: "#f6f8fa", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "64px 24px" }}>
          <h2 style={{ margin: "0 0 24px", fontSize: "28px", fontWeight: "700", color: "#0d2742", textAlign: "center" }}>Three principles we won't trade away</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "14px" }}>
            <div style={{ background: "#ffffff", border: "1px solid #dfe6ee", borderRadius: "12px", padding: "22px" }}>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#1b6fc2", letterSpacing: "0.08em" }}>01 — HONEST BOUNDARIES</div>
              <p style={{ margin: "10px 0 0", fontSize: "14px", color: "#44566b" }}>We name what CareBase doesn't replace — your eMAR, EHR, payroll, and accounting stay authoritative. No compliance guarantee, no universal ROI number.</p>
            </div>
            <div style={{ background: "#ffffff", border: "1px solid #dfe6ee", borderRadius: "12px", padding: "22px" }}>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#1b6fc2", letterSpacing: "0.08em" }}>02 — HUMANS GATE THE AI</div>
              <p style={{ margin: "10px 0 0", fontSize: "14px", color: "#44566b" }}>AI drafts training content grounded in your own documents and flags gaps instead of inventing citations — and nothing publishes without a named reviewer's sign-off.</p>
            </div>
            <div style={{ background: "#ffffff", border: "1px solid #dfe6ee", borderRadius: "12px", padding: "22px" }}>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#1b6fc2", letterSpacing: "0.08em" }}>03 — SECURITY AT THE DATABASE</div>
              <p style={{ margin: "10px 0 0", fontSize: "14px", color: "#44566b" }}>Role and facility scope are enforced by database policy, evidence lives in private storage behind short-lived links, and compliance actions are immutably logged.</p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "64px 24px" }}>
          <h2 style={{ margin: "0 0 6px", fontSize: "28px", fontWeight: "700", color: "#0d2742" }}>The team</h2>
          <p style={{ margin: "0 0 24px", fontSize: "14.5px", color: "#44566b" }}>In senior care, people buy from people they can call. Here's who answers.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div style={{ border: "1px dashed #b9c6d4", borderRadius: "14px", padding: "22px", display: "flex", gap: "16px", alignItems: "flex-start" }}>
              <div style={{ width: "96px", height: "96px", flexShrink: "0" }}><PhotoPlaceholder /></div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "12px", lineHeight: "1.6", color: "#8a99a8" }}>[ founder name & title ]<br />[ 2–3 lines: background, connection to PA senior care, and why you're building CareBase ]</div>
            </div>
            <div style={{ border: "1px dashed #b9c6d4", borderRadius: "14px", padding: "22px", display: "flex", gap: "16px", alignItems: "flex-start" }}>
              <div style={{ width: "96px", height: "96px", flexShrink: "0" }}><PhotoPlaceholder /></div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "12px", lineHeight: "1.6", color: "#8a99a8" }}>[ operator-advisor name & facility ]<br />[ 2–3 lines: operational background and operational credibility ]</div>
            </div>
          </div>
          <p style={{ margin: "14px 0 0", fontSize: "12.5px", color: "#8a99a8" }}>Placeholders on purpose — real names beat stock imagery. Drag your photos onto the circles; send the bios and we'll drop them in.</p>
        </div>
      </section>

      <section style={{ background: "#071626", color: "#ffffff" }}>
        <div style={{ position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: "0", backgroundImage: "repeating-linear-gradient(to bottom, transparent, transparent 31px, rgba(255,255,255,0.05) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, rgba(255,255,255,0.05) 32px)" }} />
          <div style={{ position: "relative", maxWidth: "1160px", margin: "0 auto", padding: "64px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700", letterSpacing: "0.14em", textTransform: "uppercase", color: "#8ec8ff" }}>Founding partners</span>
              <h2 style={{ margin: "0", fontSize: "30px", fontWeight: "700", letterSpacing: "-0.01em", textWrap: "balance" }}>Founding-partner pricing for early Pennsylvania operators</h2>
              <p style={{ margin: "0", fontSize: "15px", color: "rgba(255,255,255,0.82)" }}>A limited group of early PCH and ALF operators get founding-partner terms: direct access to the team, priority on their highest-risk workflow, and locked-in pricing for life. We ask for real usage and honest feedback.</p>
              <a href="/#start" style={{ alignSelf: "flex-start", marginTop: "6px", background: "#ffffff", color: "#0d2742", fontWeight: "700", fontSize: "14.5px", padding: "12px 20px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[#dcebfa] hover:no-underline">Start your trial — partner terms apply automatically</a>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px 18px", fontSize: "13.5px", color: "rgba(255,255,255,0.85)" }}><strong style={{ color: "#b9e4ff" }}>You get:</strong> guided setup against your roster, a direct line to the builders, your workflow prioritized on the roadmap, and founding-partner pricing locked for as long as you subscribe.</div>
              <div style={{ border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px 18px", fontSize: "13.5px", color: "rgba(255,255,255,0.85)" }}><strong style={{ color: "#b9e4ff" }}>We ask:</strong> run at least one real workflow in CareBase, a short feedback call every few weeks, and permission to quote results — never resident or staff data.</div>
              <div style={{ border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px 18px", fontSize: "13.5px", color: "rgba(255,255,255,0.85)" }}><strong style={{ color: "#b9e4ff" }}>Good fit:</strong> a PA personal care home or assisted living facility, single or multi-site, currently running compliance on spreadsheets, binders, or a training-only LMS.</div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: "#ffffff" }}>
        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "64px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h2 style={{ margin: "0", fontSize: "22px", fontWeight: "700", color: "#0d2742" }}>The CareMetric family</h2>
            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>CareBase is one of several CareMetric products for care operations.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
              <a href="https://caremetric.ai" target="_blank" rel="noreferrer">CareMetric AI →</a>
              <a href="https://cmbreathe.com" target="_blank" rel="noreferrer">CareMetric Breathe →</a>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h2 style={{ margin: "0", fontSize: "22px", fontWeight: "700", color: "#0d2742" }}>Talk to us</h2>
            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>One inbox, answered by the people building the product.</p>
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ fontSize: "15px", fontWeight: "700" }}>{CONTACT_EMAIL}</a>
            <Link href="/faq" style={{ fontSize: "14px" }}>Questions? Read the FAQ →</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
