import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { CONTACT_EMAIL } from "@/components/marketing/pricing";
import { usePageMeta } from "@/lib/usePageMeta";

const summaryRows = [
  ["Personal care home", "12 hrs per direct care worker (≤6 may be on-the-job) · +6 hrs on a secured dementia unit", "§2600.65 / .236"],
  ["Assisted living facility", "16 hrs per direct care worker · +4 dementia hrs within 30 days of hire, 2 hrs yearly after (do not count toward the 16) · 8 hrs on a special care unit", "§2800.65 / .69 / .236"],
  ["Chapter 6400 community home", "24 hrs — direct service workers, their supervisors, program specialists · 12 hrs for specified other roles", "§6400.52"],
  ["Nursing home", "12 hrs per nurse aide, tailored to the most recent performance review and facility assessment", "42 CFR 483.95"],
  ["Home health agency", "12 hrs per aide, RN-supervised and documented", "42 CFR 484.80"],
  ["Hospice agency", "12 hrs per aide, RN-supervised, across the interdisciplinary team", "42 CFR 418.76"],
] as const;

const subjectRows = [
  ["Medication self-administration support", "0.75", "0.75"],
  ["Care for residents' assessed needs", "1.25", "2.00"],
  ["Dementia, cognitive & neurological support", "1.00", "1.50"],
  ["Infection control, hygiene & immobility risks", "1.75", "2.25"],
  ["Personal-care / assisted-living services", "1.25", "2.50"],
  ["Safe management techniques & de-escalation", "1.25", "1.50"],
  ["Fire safety", "0.75", "0.75"],
  ["Emergency preparedness", "1.25", "1.50"],
  ["Resident rights", "0.75", "0.75"],
  ["OAPSA abuse recognition & reporting", "0.50", "0.50"],
  ["Falls & accident prevention", "1.50", "2.00"],
] as const;

export default function Requirements() {
  usePageMeta({ ...MARKETING_ROUTE_META["/requirements"], path: "/requirements" });

  return (
    <MarketingLayout>
      <section style={{ position: "relative", overflow: "hidden", background: "linear-gradient(135deg, #071626 0%, #0d2742 55%, #143a5c 100%)", color: "#ffffff" }}>
        <div style={{ position: "absolute", inset: "0", backgroundImage: "repeating-linear-gradient(to bottom, transparent, transparent 31px, rgba(255,255,255,0.05) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, rgba(255,255,255,0.05) 32px)" }} />
        <div style={{ position: "relative", maxWidth: "860px", margin: "0 auto", padding: "64px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
          <span style={{ display: "inline-flex", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", borderRadius: "99px", padding: "6px 14px", fontSize: "12px", fontWeight: "700", color: "#b9e4ff" }}>Free resource · last reviewed July 2026</span>
          <h1 style={{ margin: "0", fontSize: "42px", fontWeight: "700", letterSpacing: "-0.015em", lineHeight: "1.1", textWrap: "balance" }}>Pennsylvania annual training requirements, by facility type</h1>
          <p style={{ margin: "0", fontSize: "17px", color: "rgba(255,255,255,0.85)", maxWidth: "56ch", textWrap: "pretty" }}>What 55 Pa. Code and the federal aide rules actually require each year — the hour totals, the required subjects, and where the exceptions hide.</p>
        </div>
      </section>

      <section style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "980px", margin: "0 auto", padding: "56px 24px" }}>
          <h2 style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: "700", color: "#0d2742" }}>The short version</h2>
          <p style={{ margin: "0 0 20px", fontSize: "14.5px", color: "#44566b" }}>Annual in-service minimums per direct care worker or aide. Details, dementia add-ons, and role carve-outs follow below.</p>
          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.5fr 0.8fr", fontSize: "13.5px", minWidth: "640px" }}>
              <div style={{ padding: "12px 18px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a", borderBottom: "1px solid #eef2f6", background: "#fafbfc" }}>SETTING</div>
              <div style={{ padding: "12px 8px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a", borderBottom: "1px solid #eef2f6", background: "#fafbfc" }}>ANNUAL REQUIREMENT</div>
              <div style={{ padding: "12px 18px 12px 8px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a", borderBottom: "1px solid #eef2f6", background: "#fafbfc" }}>CITATION</div>
              {summaryRows.map(([setting, requirement, citation], index) => {
                const isLast = index === summaryRows.length - 1;
                return (
                  <div key={setting} style={{ display: "contents" }}>
                    <div style={{ padding: "12px 18px", borderBottom: isLast ? undefined : "1px solid #eef2f6", fontWeight: "700" }}>{setting}</div>
                    <div style={{ padding: "12px 8px", borderBottom: isLast ? undefined : "1px solid #eef2f6", color: "#44566b" }}>{requirement}</div>
                    <div style={{ padding: "12px 18px 12px 8px", borderBottom: isLast ? undefined : "1px solid #eef2f6", fontFamily: "ui-monospace, monospace", fontSize: "12px", color: "#64768a" }}>{citation}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ marginTop: "16px", border: "1px solid #f0d9a8", background: "#fdf7ea", borderRadius: "10px", padding: "14px 18px", fontSize: "13px", color: "#6d5312" }}>This guide is informational, not legal advice. Requirements depend on license type, role, assignment, and population served — verify against the current regulations (linked below) and your DHS regional office.</div>
        </div>
      </section>

      <section style={{ background: "#f6f8fa", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "980px", margin: "0 auto", padding: "56px 24px" }}>
          <h2 style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: "700", color: "#0d2742" }}>PCH & ALF: how the annual hours break down by subject</h2>
          <p style={{ margin: "0 0 20px", fontSize: "14.5px", color: "#44566b", maxWidth: "72ch" }}>§2600.65(f)–(g) and §2800.65(i)–(j) name the required subjects but generally don't prescribe minutes per subject. The allocation below is CareBase's curriculum design covering every required topic — not a regulator-issued hour split.</p>
          <div style={{ background: "#ffffff", border: "1px solid #dfe6ee", borderRadius: "14px", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 0.5fr 0.5fr", fontSize: "13.5px" }}>
              <div style={{ padding: "12px 18px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a", borderBottom: "1px solid #eef2f6", background: "#fafbfc" }}>REQUIRED SUBJECT</div>
              <div style={{ padding: "12px 8px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a", borderBottom: "1px solid #eef2f6", background: "#fafbfc", textAlign: "right" }}>PCH HRS</div>
              <div style={{ padding: "12px 18px 12px 8px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a", borderBottom: "1px solid #eef2f6", background: "#fafbfc", textAlign: "right" }}>ALF HRS</div>
              {subjectRows.map(([subject, pch, alf]) => (
                <div key={subject} style={{ display: "contents" }}>
                  <div style={{ padding: "10px 18px", borderBottom: "1px solid #eef2f6", color: "#33465c" }}>{subject}</div>
                  <div style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f6", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{pch}</div>
                  <div style={{ padding: "10px 18px 10px 8px", borderBottom: "1px solid #eef2f6", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{alf}</div>
                </div>
              ))}
              <div style={{ padding: "11px 18px", borderBottom: "1px solid #eef2f6", fontWeight: "800", color: "#0d2742", background: "#eaf3fc" }}>Annual total</div><div style={{ padding: "11px 8px", borderBottom: "1px solid #eef2f6", textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: "700", background: "#eaf3fc" }}>12.00</div><div style={{ padding: "11px 18px 11px 8px", borderBottom: "1px solid #eef2f6", textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: "700", background: "#eaf3fc" }}>16.00</div>
              <div style={{ padding: "10px 18px", borderBottom: "1px solid #eef2f6", color: "#64768a" }}>+ Mental illness / intellectual disability, if served</div><div style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f6", textAlign: "right", fontFamily: "ui-monospace, monospace", color: "#64768a" }}>+0.75</div><div style={{ padding: "10px 18px 10px 8px", borderBottom: "1px solid #eef2f6", textAlign: "right", fontFamily: "ui-monospace, monospace", color: "#64768a" }}>+1.00</div>
              <div style={{ padding: "10px 18px", color: "#64768a" }}>+ Newly served population, when applicable</div><div style={{ padding: "10px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace", color: "#64768a" }}>+0.50</div><div style={{ padding: "10px 18px 10px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace", color: "#64768a" }}>+0.50–0.75</div>
            </div>
            <div style={{ padding: "12px 18px", borderTop: "1px solid #eef2f6", background: "#fafbfc", fontSize: "12px", color: "#64768a" }}>Conditional topics add hours only when they apply — an N/A topic never produces fabricated credit. Up to 6 of the PCH hours may be supervised on-the-job training.</div>
          </div>
        </div>
      </section>

      <section style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>
        <div style={{ maxWidth: "980px", margin: "0 auto", padding: "56px 24px", display: "flex", flexDirection: "column", gap: "40px" }}>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: "700", color: "#0d2742" }}>Dementia & specialty-unit add-ons</h2>
            <p style={{ margin: "0 0 20px", fontSize: "14.5px", color: "#44566b" }}>These are separate requirements on top of the annual totals above.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ border: "1px solid #dfe6ee", borderRadius: "12px", padding: "18px" }}><div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#1b6fc2" }}>§2800.69 — ALF DEMENTIA</div><p style={{ margin: "8px 0 0", fontSize: "13.5px", color: "#44566b" }}>4 hours of dementia-specific training within 30 days of hire, then 2 hours every year after. These hours do <strong>not</strong> count toward the 16-hour annual total.</p></div>
              <div style={{ border: "1px solid #dfe6ee", borderRadius: "12px", padding: "18px" }}><div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#1b6fc2" }}>§2600.236 — PCH SECURED DEMENTIA UNIT</div><p style={{ margin: "8px 0 0", fontSize: "13.5px", color: "#44566b" }}>6 additional annual hours for staff assigned to a secured dementia care unit. Structured training — on-the-job hours don't qualify.</p></div>
              <div style={{ border: "1px solid #dfe6ee", borderRadius: "12px", padding: "18px" }}><div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#1b6fc2" }}>§2800.236 — ALF SPECIAL CARE UNITS</div><p style={{ margin: "8px 0 0", fontSize: "13.5px", color: "#44566b" }}>8 annual hours for staff on a dementia special care unit, and separately 8 hours for an INRBI special care unit. Unit assignment required.</p></div>
              <div style={{ border: "1px solid #dfe6ee", borderRadius: "12px", padding: "18px" }}><div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#1b6fc2" }}>ADMINISTRATORS</div><p style={{ margin: "8px 0 0", fontSize: "13.5px", color: "#44566b" }}>PCH and ALF administrators carry their own 24-hour annual continuing-education requirement, separate from staff in-service hours — plus the 100-hour qualification course (or NHA exemption).</p></div>
            </div>
          </div>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: "700", color: "#0d2742" }}>Chapter 6400 community homes</h2>
            <p style={{ margin: "0 0 16px", fontSize: "14.5px", color: "#44566b", maxWidth: "72ch" }}>§6400.52 requires <strong>24 annual hours</strong> for direct service workers, their direct supervisors, and program specialists — and separately <strong>12 hours</strong> for specified other roles. The 24-hour core covers: person-centered practice and community relationships (4 hrs) · abuse prevention and protective-services reporting (4) · rights foundations and rights in daily practice (4) · incident response, documentation and prevention (4) · health/safety, records/funds, medication awareness, and emergency readiness (4) · current person-specific behavior support (2) · current assessment and Individual Plan implementation (2).</p>
            <div style={{ border: "1px solid #dfe6ee", background: "#fafbfc", borderRadius: "10px", padding: "14px 18px", fontSize: "13px", color: "#44566b" }}>§6400.46 separately requires 1 hour of qualified fire-safety training and a 3-hour first-aid / Heimlich / CPR skills course from an eligible certified trainer, delivered in person. Person-specific behavior-support and plan work must be facilitated — not web-only.</div>
          </div>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: "700", color: "#0d2742" }}>Clinical aide paths — 12 hours each</h2>
            <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "12px" }}>
              <div style={{ border: "1px solid #dfe6ee", borderRadius: "12px", padding: "18px" }}><div style={{ fontWeight: "700", fontSize: "14.5px", color: "#0d2742" }}>Nursing-home nurse aide</div><div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#64768a", marginTop: "2px" }}>42 CFR 483.95 · 28 Pa. Code 201.20</div><p style={{ margin: "8px 0 0", fontSize: "13px", color: "#44566b" }}>Tailored to each aide's most recent performance review and the facility assessment — not a generic annual class. Facility acceptance and documented attendance required.</p></div>
              <div style={{ border: "1px solid #dfe6ee", borderRadius: "12px", padding: "18px" }}><div style={{ fontWeight: "700", fontSize: "14.5px", color: "#0d2742" }}>Home health aide</div><div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#64768a", marginTop: "2px" }}>42 CFR 484.80 · 28 Pa. Code 601.35</div><p style={{ margin: "8px 0 0", fontSize: "13px", color: "#44566b" }}>RN-supervised and documented by the employing agency, covering care-plan boundaries, observation and escalation, home safety, and required skill work.</p></div>
              <div style={{ border: "1px solid #dfe6ee", borderRadius: "12px", padding: "18px" }}><div style={{ fontWeight: "700", fontSize: "14.5px", color: "#0d2742" }}>Hospice aide</div><div style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#64768a", marginTop: "2px" }}>42 CFR 418.76</div><p style={{ margin: "8px 0 0", fontSize: "13px", color: "#44566b" }}>RN-supervised, adding hospice philosophy, the interdisciplinary group, grief and family support, active dying, and symptom escalation.</p></div>
            </div>
          </div>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: "700", color: "#0d2742" }}>What no course can self-certify</h2>
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", color: "#44566b" }}>
              <div style={{ display: "flex", gap: "10px" }}><span style={{ color: "#a83a2c", fontWeight: "800" }}>✕</span><span>Unlicensed medication administration — requires the DHS-approved program and testing; insulin and epinephrine carry additional requirements.</span></div>
              <div style={{ display: "flex", gap: "10px" }}><span style={{ color: "#a83a2c", fontWeight: "800" }}>✕</span><span>CPR / first aid, qualified fire-safety training, and facility-plan exercises — require certified trainers or facilitators with retained external evidence.</span></div>
              <div style={{ display: "flex", gap: "10px" }}><span style={{ color: "#a83a2c", fontWeight: "800" }}>✕</span><span>Administrator continuing education — approved-provider rules apply; a completion certificate is not, by itself, accepted administrator CE.</span></div>
              <div style={{ display: "flex", gap: "10px" }}><span style={{ color: "#a83a2c", fontWeight: "800" }}>✕</span><span>A certificate of course completion is never, by itself, a claim of Department, CMS, or professional-board approval.</span></div>
            </div>
          </div>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: "700", color: "#0d2742" }}>Primary sources</h2>
            <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 24px", fontSize: "13.5px" }}>
              <a href="https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html" target="_blank" rel="noreferrer">55 Pa. Code §2600.65 — PCH annual staff training</a>
              <a href="https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.236.html" target="_blank" rel="noreferrer">55 Pa. Code §2600.236 — PCH secured dementia unit</a>
              <a href="https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html" target="_blank" rel="noreferrer">55 Pa. Code §2800.65 — ALF annual staff training</a>
              <a href="https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.69.html" target="_blank" rel="noreferrer">55 Pa. Code §2800.69 — additional ALF dementia training</a>
              <a href="https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter6400/s6400.52.html" target="_blank" rel="noreferrer">55 Pa. Code §6400.52 — Chapter 6400 annual training</a>
              <a href="https://www.ecfr.gov/current/title-42/part-483/section-483.95" target="_blank" rel="noreferrer">42 CFR §483.95 — nursing facility training</a>
              <a href="https://www.ecfr.gov/current/title-42/part-484/section-484.80" target="_blank" rel="noreferrer">42 CFR §484.80 — home health aide in-service</a>
              <a href="https://www.ecfr.gov/current/title-42/part-418/section-418.76" target="_blank" rel="noreferrer">42 CFR §418.76 — hospice aide in-service</a>
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: "#eaf3fc", borderBottom: "1px solid #cfe2f4" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "40px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
          <h2 style={{ margin: "0", fontSize: "22px", fontWeight: "700", color: "#0d2742" }}>Keep this guide</h2>
          <p style={{ margin: "0", fontSize: "14px", color: "#44566b", maxWidth: "52ch" }}>Ask for the PDF version for your binder — plus an update when the regulations change. Nothing else, no drip sequence.</p>
          <a href={`mailto:${CONTACT_EMAIL}?subject=CareBase%20PA%20requirements%20guide%20PDF`} style={{ background: "#1b6fc2", color: "#ffffff", fontWeight: "700", fontSize: "14px", padding: "11px 16px", borderRadius: "8px", textDecoration: "none", whiteSpace: "nowrap" }} className="hover:bg-[#14548f] hover:no-underline">Email me the PDF</a>
        </div>
      </section>

      <section style={{ background: "#071626", color: "#ffffff" }}>
        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "56px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "14px", alignItems: "center" }}>
          <h2 style={{ margin: "0", fontSize: "28px", fontWeight: "700", letterSpacing: "-0.01em" }}>CareBase applies all of this automatically</h2>
          <p style={{ margin: "0", fontSize: "15px", color: "rgba(255,255,255,0.82)", maxWidth: "52ch" }}>Facility type and role map each employee to the right hour buckets, subjects, and renewal windows — configured once, tracked continuously.</p>
          <div style={{ display: "flex", gap: "12px", marginTop: "6px" }}>
            <a href="/#pricing" style={{ background: "#ffffff", color: "#0d2742", fontWeight: "700", fontSize: "14.5px", padding: "12px 20px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[#dcebfa] hover:no-underline">Start a free trial</a>
            <Link href="/faq" style={{ border: "1px solid rgba(255,255,255,0.3)", color: "#ffffff", fontWeight: "700", fontSize: "14.5px", padding: "12px 20px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[rgba(255,255,255,0.12)] hover:no-underline">Questions? Read the FAQ</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
