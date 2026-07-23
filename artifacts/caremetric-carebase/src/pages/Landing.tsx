import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { CONTACT_EMAIL, GROWTH_PRICE, STARTER_PRICE, TRIAL_DAYS } from "@/components/marketing/pricing";
import { usePageMeta } from "@/lib/usePageMeta";

type DomainIndex = 0 | 1 | 2 | 3;

const MARKETING_KEYFRAMES = `@keyframes cbFadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes cbPulse{0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,0.55)}50%{box-shadow:0 0 0 7px rgba(74,222,128,0)}}
@keyframes cbFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`;

function tabButtonStyle(domain: DomainIndex, index: DomainIndex): CSSProperties {
  const active = domain === index;
  const background = active ? "#0d2742" : "#ffffff";
  const color = active ? "#ffffff" : "#44566b";
  const borderColor = active ? "#0d2742" : "#c8d4e0";

  return {
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "14px",
    fontWeight: "700",
    padding: "10px 18px",
    borderRadius: "99px",
    border: `1px solid ${borderColor}`,
    background,
    color,
  };
}

export default function Landing() {
  usePageMeta({ ...MARKETING_ROUTE_META["/"], path: "/" });

  const [heroScore, setHeroScore] = useState(0);
  const [domain, setDomain] = useState<DomainIndex>(0);

  useEffect(() => {
    let t = 0;
    const scoreTimer = window.setInterval(() => {
      t += 1;
      const value = Math.min(94, Math.round(94 * (1 - Math.pow(1 - t / 45, 3))));
      setHeroScore(value);
      if (value >= 94) {
        window.clearInterval(scoreTimer);
      }
    }, 26);

    return () => window.clearInterval(scoreTimer);
  }, []);

  return (
    <MarketingLayout>
      <style>{MARKETING_KEYFRAMES}</style>
    <section id="top" style={{ position: "relative", overflow: "hidden", background: "linear-gradient(135deg, #071626 0%, #0d2742 55%, #143a5c 100%)", color: "#ffffff" }}>

      <div style={{ position: "absolute", inset: "0", backgroundImage: "repeating-linear-gradient(to bottom, transparent, transparent 31px, rgba(255,255,255,0.05) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, rgba(255,255,255,0.05) 32px)" }}></div>

      <div style={{ position: "relative", maxWidth: "1160px", margin: "0 auto", padding: "72px 24px 56px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "48px", alignItems: "center" }}>

        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>

          <span style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", borderRadius: "99px", padding: "6px 14px", fontSize: "12px", fontWeight: "700", color: "#b9e4ff", animation: "cbFadeUp 0.6s ease-out both" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "99px", background: "#4ade80", animation: "cbPulse 2.2s ease-in-out infinite" }}></span>Built for Pennsylvania PCH & ALF operators</span>

          <h1 style={{ margin: "0", fontSize: "58px", fontWeight: "800", letterSpacing: "-0.02em", lineHeight: "1.05", textWrap: "balance" }}>
            <span style={{ display: "block", animation: "cbFadeUp 0.6s ease-out 0.05s both" }}>Run the facility.</span>
            <span style={{ display: "block", animation: "cbFadeUp 0.6s ease-out 0.18s both" }}>See the risk.</span>
            <span style={{ display: "block", color: "#8ec8ff", animation: "cbFadeUp 0.6s ease-out 0.31s both" }}>Prove the work.</span></h1>

          <p style={{ margin: "0", fontSize: "19px", lineHeight: "1.5", color: "rgba(255,255,255,0.85)", maxWidth: "34ch", textWrap: "pretty", animation: "cbFadeUp 0.6s ease-out 0.42s both" }}>Know you're survey-ready before the knock — without running your facility out of spreadsheets, binders, and one person's memory.</p>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>

            <a href="#pricing" style={{ background: "#ffffff", color: "#0d2742", fontWeight: "700", fontSize: "15px", padding: "13px 22px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[#dcebfa] hover:no-underline">Start a free trial</a>

            <Link href="/how-it-works" style={{ border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.06)", color: "#ffffff", fontWeight: "700", fontSize: "15px", padding: "13px 22px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[rgba(255,255,255,0.14)] hover:no-underline">See how it works</Link>
      </div>

          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.75)" }}>Fully self-service — signup to first binder without a phone call. {TRIAL_DAYS}-day free trial.</div>
    </div>


        <div style={{ position: "relative" }}>

          <div style={{ background: "#ffffff", color: "#1c2b3a", borderRadius: "14px", boxShadow: "0 30px 60px rgba(0,0,0,0.4)", overflow: "hidden", animation: "cbFadeUp 0.7s ease-out 0.3s both" }}>

            <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 16px", borderBottom: "1px solid #e5eaf0", background: "#f6f8fa" }}>

              <span style={{ width: "9px", height: "9px", borderRadius: "99px", background: "#e4b1ab" }}></span>

              <span style={{ width: "9px", height: "9px", borderRadius: "99px", background: "#e8d3a4" }}></span>

              <span style={{ width: "9px", height: "9px", borderRadius: "99px", background: "#aed4b3" }}></span>

              <span style={{ marginLeft: "8px", fontFamily: "ui-monospace, monospace", fontSize: "10px", letterSpacing: "0.06em", color: "#64768a" }}>CAREBASE / FACILITY COMMAND CENTER</span>
        </div>

            <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #e5eaf0" }}>

              <div>

                <div style={{ fontWeight: "700", fontSize: "15px" }}>Sunrise Healthcare Group</div>

                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "10px", color: "#64768a" }}>4 facilities · 186 employees · binder ready</div>
          </div>

              <span style={{ background: "#eaf6ec", color: "#1e7a35", fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700", borderRadius: "99px", padding: "4px 10px" }}>{heroScore}% compliant</span>
        </div>

            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>

              <div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "5px" }}>
                  <span style={{ fontWeight: "600" }}>Annual in-service hours</span>
                  <span style={{ color: "#1e7a35", fontFamily: "ui-monospace, monospace", fontSize: "11px" }}>On track</span></div>

                <div style={{ height: "8px", borderRadius: "99px", background: "#edf1f5" }}>
                  <div style={{ height: "8px", width: "92%", borderRadius: "99px", background: "linear-gradient(to right, #1b6fc2, #59b2ff)" }}></div></div>
          </div>

              <div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "5px" }}>
                  <span style={{ fontWeight: "600" }}>Medication practicums</span>
                  <span style={{ color: "#1e7a35", fontFamily: "ui-monospace, monospace", fontSize: "11px" }}>Current</span></div>

                <div style={{ height: "8px", borderRadius: "99px", background: "#edf1f5" }}>
                  <div style={{ height: "8px", width: "88%", borderRadius: "99px", background: "linear-gradient(to right, #1b6fc2, #59b2ff)" }}></div></div>
          </div>

              <div style={{ background: "#fdf4e3", border: "1px solid #f0d9a8", borderRadius: "10px", padding: "10px 12px" }}>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "5px" }}>
                  <span style={{ fontWeight: "700", color: "#8a5a00" }}>Expiring credentials</span>
                  <span style={{ color: "#8a5a00", fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700" }}>3 due in 21 days</span></div>

                <div style={{ height: "8px", borderRadius: "99px", background: "#f3e4c2" }}>
                  <div style={{ height: "8px", width: "74%", borderRadius: "99px", background: "#d99a1b" }}></div></div>

                <div style={{ marginTop: "7px", fontSize: "11px", color: "#6d5312" }}>Act 34 clearance — J. Miller, R. Chen, T. Brooks · alert sent to facility manager</div>
          </div>

              <div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "5px" }}>
                  <span style={{ fontWeight: "600" }}>Resident assessments</span>
                  <span style={{ color: "#1e7a35", fontFamily: "ui-monospace, monospace", fontSize: "11px" }}>5 due · scheduled</span></div>

                <div style={{ height: "8px", borderRadius: "99px", background: "#edf1f5" }}>
                  <div style={{ height: "8px", width: "90%", borderRadius: "99px", background: "linear-gradient(to right, #1b6fc2, #59b2ff)" }}></div></div>
          </div>
        </div>
      </div>

          <div style={{ position: "absolute", bottom: "-18px", left: "-18px", background: "#ffffff", color: "#1c2b3a", border: "1px solid #e5eaf0", borderRadius: "10px", padding: "10px 14px", boxShadow: "0 14px 30px rgba(0,0,0,0.3)", animation: "cbFloat 5s ease-in-out infinite" }}>

            <div style={{ fontSize: "12px", fontWeight: "700", color: "#0d2742" }}>Risk caught before survey day</div>

            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "10.5px", color: "#64768a" }}>Retraining assigned · due Aug 2 · evidence attached</div>
      </div>
    </div>
  </div>


      <div style={{ position: "relative", maxWidth: "1160px", margin: "0 auto", padding: "0 24px 56px" }}>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.14)", paddingTop: "26px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "24px" }}>

          <div>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "22px", fontWeight: "700" }}>12–16 hrs</div>
            <div style={{ marginTop: "3px", fontSize: "12.5px", color: "rgba(255,255,255,0.78)" }}>annual training tracked per direct care worker, by facility type</div></div>

          <div>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "22px", fontWeight: "700" }}>Ch. 2600 + 2800</div>
            <div style={{ marginTop: "3px", fontSize: "12.5px", color: "rgba(255,255,255,0.78)" }}>PA regulations crosswalked to the records that prove them</div></div>

          <div>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "22px", fontWeight: "700" }}>60+</div>
            <div style={{ marginTop: "3px", fontSize: "12.5px", color: "rgba(255,255,255,0.78)" }}>survey-ready form templates included</div></div>

          <div>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "22px", fontWeight: "700" }}>1 record</div>
            <div style={{ marginTop: "3px", fontSize: "12.5px", color: "rgba(255,255,255,0.78)" }}>every role — admin to auditor — works from the same evidence</div></div>
    </div>
  </div>
</section>


    <section style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>

      <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "72px 24px" }}>

        <div style={{ textAlign: "center", maxWidth: "780px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>

          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700", letterSpacing: "0.14em", textTransform: "uppercase", color: "#1b6fc2" }}>In plain English</span>

          <h2 style={{ margin: "0", fontSize: "36px", fontWeight: "700", letterSpacing: "-0.015em", color: "#0d2742", textWrap: "balance" }}>One system that proves your facility is doing its job</h2>

          <p style={{ margin: "0", color: "#44566b", fontSize: "16.5px", lineHeight: "1.6", textWrap: "pretty" }}>CareBase tracks every training hour, credential, clearance, resident assessment, incident, and inspection your Pennsylvania license requires — assigns the work to the right person before it's late, and turns the proof into a binder your surveyor can't argue with.</p>
    </div>

        <div style={{ marginTop: "40px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "16px" }}>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "10px", boxShadow: "0 6px 20px rgba(13,39,66,0.04)" }}>

            <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: "40px", fontWeight: "800", color: "#dcebfa", lineHeight: "1" }}>01</div>

            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "10.5px", fontWeight: "700", letterSpacing: "0.12em", color: "#1b6fc2" }}>SURVEY READINESS</div>

            <h3 style={{ margin: "0", fontSize: "19px", fontWeight: "700", color: "#0d2742" }}>Pass your next survey</h3>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>Every §2600 / §2800 requirement lives on its own clock with evidence attached as work happens. When the surveyor knocks, the binder is an export — not a lost weekend.</p>

            <Link href="/how-it-works" style={{ marginTop: "auto", fontWeight: "700", fontSize: "13.5px" }}>See how it works →</Link>
      </div>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "10px", boxShadow: "0 6px 20px rgba(13,39,66,0.04)" }}>

            <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: "40px", fontWeight: "800", color: "#dcebfa", lineHeight: "1" }}>02</div>

            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "10.5px", fontWeight: "700", letterSpacing: "0.12em", color: "#1b6fc2" }}>EDUCATION SPEND</div>

            <h3 style={{ margin: "0", fontSize: "19px", fontWeight: "700", color: "#0d2742" }}>Spend less on required education</h3>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>The course builder, AI course creation from your own policies, live QR classes, and certificates are built in — stop paying per-seat LMS fees and yearly content libraries for the same mandatory topics.</p>

            <Link href="/savings" style={{ marginTop: "auto", fontWeight: "700", fontSize: "13.5px" }}>See where the money comes from →</Link>
      </div>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "10px", boxShadow: "0 6px 20px rgba(13,39,66,0.04)" }}>

            <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: "40px", fontWeight: "800", color: "#dcebfa", lineHeight: "1" }}>03</div>

            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "10.5px", fontWeight: "700", letterSpacing: "0.12em", color: "#1b6fc2" }}>YOUR TIME</div>

            <h3 style={{ margin: "0", fontSize: "19px", fontWeight: "700", color: "#0d2742" }}>Get your evenings back</h3>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>The system nags, routes, escalates, and files so compliance stops living in one person's memory — and stops following you home in a tote bag of binders.</p>
      </div>
    </div>
  </div>
</section>


    <section style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>

      <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "56px 24px" }}>

        <h2 style={{ margin: "0 0 22px", fontSize: "28px", fontWeight: "700", letterSpacing: "-0.01em", color: "#0d2742", textAlign: "center" }}>Which facility do you run?</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 6px 20px rgba(13,39,66,0.04)" }}>

            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", color: "#1b6fc2" }}>55 PA. CODE CHAPTER 2600</span>

            <h3 style={{ margin: "0", fontSize: "21px", fontWeight: "700", color: "#0d2742" }}>I run a personal care home</h3>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>Your surveyor wants 12 annual in-service hours per direct care worker (§2600.65, up to 6 on-the-job), current RASP assessments and support plans, medication practicums, Act 34 clearances, and fire drill logs — with proof for each.</p>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>
              <strong style={{ color: "#0d2742" }}>Your usual failure mode isn't missing training — it's the sign-in sheet nobody can find.</strong> CareBase logs the hours as they happen and keeps the evidence attached.</p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>

              <span style={{ background: "#f0f5fa", borderRadius: "99px", padding: "4px 11px", fontSize: "12px", fontWeight: "600", color: "#33465c" }}>12-hr buckets auto-applied</span>

              <span style={{ background: "#f0f5fa", borderRadius: "99px", padding: "4px 11px", fontSize: "12px", fontWeight: "600", color: "#33465c" }}>+6 hrs secured dementia unit</span>

              <span style={{ background: "#f0f5fa", borderRadius: "99px", padding: "4px 11px", fontSize: "12px", fontWeight: "600", color: "#33465c" }}>Ch. 2600 crosswalk</span>
        </div>

            <a href="#start" style={{ marginTop: "auto", alignSelf: "flex-start", fontWeight: "700", fontSize: "14px" }}>Set up your PCH in minutes →</a>
      </div>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 6px 20px rgba(13,39,66,0.04)" }}>

            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", color: "#1b6fc2" }}>55 PA. CODE CHAPTER 2800</span>

            <h3 style={{ margin: "0", fontSize: "21px", fontWeight: "700", color: "#0d2742" }}>I run an assisted living facility</h3>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>You carry the heavier load: 16 annual hours per direct care worker (§2800.65), dementia training that
              <em>doesn't</em> count toward the 16 (§2800.69), special-care-unit add-ons, and ASP assessments on their own clocks.</p>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>
              <strong style={{ color: "#0d2742" }}>The dementia-hours carve-out is where ALFs get cited.</strong> CareBase tracks the buckets separately so nothing double-counts.</p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>

              <span style={{ background: "#f0f5fa", borderRadius: "99px", padding: "4px 11px", fontSize: "12px", fontWeight: "600", color: "#33465c" }}>16-hr buckets auto-applied</span>

              <span style={{ background: "#f0f5fa", borderRadius: "99px", padding: "4px 11px", fontSize: "12px", fontWeight: "600", color: "#33465c" }}>Dementia hrs tracked separately</span>

              <span style={{ background: "#f0f5fa", borderRadius: "99px", padding: "4px 11px", fontSize: "12px", fontWeight: "600", color: "#33465c" }}>Ch. 2800 crosswalk</span>
        </div>

            <a href="#start" style={{ marginTop: "auto", alignSelf: "flex-start", fontWeight: "700", fontSize: "14px" }}>Set up your ALF in minutes →</a>
      </div>
    </div>

        <p style={{ margin: "18px auto 0", textAlign: "center", fontSize: "13px", color: "#64768a" }}>Group home, nursing, home health, or hospice? The
          <Link href="/requirements">requirements guide</Link> covers your pathway too.</p>
  </div>
</section>


    <section id="platform" style={{ scrollMarginTop: "72px", background: "#f6f8fa", borderBottom: "1px solid #e5eaf0" }}>

      <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "72px 24px" }}>

        <div style={{ maxWidth: "640px", display: "flex", flexDirection: "column", gap: "12px" }}>

          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700", letterSpacing: "0.14em", textTransform: "uppercase", color: "#1b6fc2" }}>The whole facility, one record</span>

          <h2 style={{ margin: "0", fontSize: "34px", fontWeight: "700", letterSpacing: "-0.015em", color: "#0d2742", textWrap: "balance" }}>Stop being the person who remembers everything</h2>

          <p style={{ margin: "0", color: "#44566b", textWrap: "pretty" }}>Residents, staff, the building, and the survey — every deadline on its own clock, every task owned, every completion leaving proof. Pick a domain to see the actual workflow.</p>
    </div>


        <div style={{ marginTop: "28px", display: "flex", gap: "8px", flexWrap: "wrap" }}>

          <button type="button" onClick={() => setDomain(0 as DomainIndex)} style={tabButtonStyle(domain, 0 as DomainIndex)}>Residents</button>

          <button type="button" onClick={() => setDomain(1 as DomainIndex)} style={tabButtonStyle(domain, 1 as DomainIndex)}>Workforce</button>

          <button type="button" onClick={() => setDomain(2 as DomainIndex)} style={tabButtonStyle(domain, 2 as DomainIndex)}>Facility & safety</button>

          <button type="button" onClick={() => setDomain(3 as DomainIndex)} style={tabButtonStyle(domain, 3 as DomainIndex)}>Survey evidence</button>
    </div>


        {domain === 0 && (
<div style={{ marginTop: "22px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "24px", alignItems: "start" }}>

            <div style={{ background: "#ffffff", border: "1px solid #dfe6ee", borderRadius: "14px", overflow: "hidden", boxShadow: "0 10px 30px rgba(13,39,66,0.07)" }}>

              <div style={{ padding: "12px 18px", borderBottom: "1px solid #e5eaf0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>

                <span style={{ fontWeight: "700", fontSize: "14px" }}>Resident compliance — Maple Grove</span>

                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#64768a" }}>Census 42 / 48 · 3 move-ins this month</span>
        </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.5fr 1.1fr 1.1fr", gap: "0", fontSize: "13px" }}>

                <div style={{ padding: "10px 18px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a", borderBottom: "1px solid #eef2f6" }}>RESIDENT</div>

                <div style={{ padding: "10px 8px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a", borderBottom: "1px solid #eef2f6" }}>ROOM</div>

                <div style={{ padding: "10px 8px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a", borderBottom: "1px solid #eef2f6" }}>RASP STATUS</div>

                <div style={{ padding: "10px 18px 10px 8px", fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a", borderBottom: "1px solid #eef2f6" }}>SUPPORT PLAN</div>

                <div style={{ padding: "11px 18px", borderBottom: "1px solid #eef2f6", fontWeight: "600" }}>M. Alvarez</div>
                <div style={{ padding: "11px 8px", borderBottom: "1px solid #eef2f6", color: "#64768a" }}>12</div>
                <div style={{ padding: "11px 8px", borderBottom: "1px solid #eef2f6" }}>
                  <span style={{ background: "#eaf6ec", color: "#1e7a35", borderRadius: "99px", padding: "2px 9px", fontSize: "11.5px", fontWeight: "700" }}>Current</span></div>
                <div style={{ padding: "11px 18px 11px 8px", borderBottom: "1px solid #eef2f6", color: "#44566b" }}>Updated May 2</div>

                <div style={{ padding: "11px 18px", borderBottom: "1px solid #eef2f6", fontWeight: "600" }}>J. Okafor</div>
                <div style={{ padding: "11px 8px", borderBottom: "1px solid #eef2f6", color: "#64768a" }}>07</div>
                <div style={{ padding: "11px 8px", borderBottom: "1px solid #eef2f6" }}>
                  <span style={{ background: "#fdf4e3", color: "#8a5a00", borderRadius: "99px", padding: "2px 9px", fontSize: "11.5px", fontWeight: "700" }}>Annual due · 14d</span></div>
                <div style={{ padding: "11px 18px 11px 8px", borderBottom: "1px solid #eef2f6", color: "#44566b" }}>Review opened</div>

                <div style={{ padding: "11px 18px", borderBottom: "1px solid #eef2f6", fontWeight: "600" }}>R. Santos</div>
                <div style={{ padding: "11px 8px", borderBottom: "1px solid #eef2f6", color: "#64768a" }}>21</div>
                <div style={{ padding: "11px 8px", borderBottom: "1px solid #eef2f6" }}>
                  <span style={{ background: "#fbe9e7", color: "#a83a2c", borderRadius: "99px", padding: "2px 9px", fontSize: "11.5px", fontWeight: "700" }}>Overdue · 3d</span></div>
                <div style={{ padding: "11px 18px 11px 8px", borderBottom: "1px solid #eef2f6", color: "#a83a2c", fontWeight: "600" }}>Reassess first</div>

                <div style={{ padding: "11px 18px" }}>
                  <span style={{ fontWeight: "600" }}>E. Werner</span></div>
                <div style={{ padding: "11px 8px", color: "#64768a" }}>09</div>
                <div style={{ padding: "11px 8px" }}>
                  <span style={{ background: "#eaf6ec", color: "#1e7a35", borderRadius: "99px", padding: "2px 9px", fontSize: "11.5px", fontWeight: "700" }}>Current</span></div>
                <div style={{ padding: "11px 18px 11px 8px", color: "#44566b" }}>Updated Jun 10</div>
        </div>

              <div style={{ padding: "12px 18px", borderTop: "1px solid #eef2f6", background: "#fafbfc", fontSize: "12px", color: "#64768a" }}>Completing a reassessment auto-opens the support-plan update it requires — §2600.225/.227 tracked per resident.</div>
      </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

              <h3 style={{ margin: "0", fontSize: "18px", fontWeight: "800", color: "#0d2742" }}>From inquiry to discharge</h3>

              <p style={{ margin: "0 0 4px", fontSize: "14px", color: "#44566b" }}>Resident-level compliance and the daily work around it — each item on its own due-date clock.</p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Admissions & census</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>RASP / ASP assessments</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Support-plan triggers</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Resident services & refusals</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Change-of-condition follow-up</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Dietary & food safety rounds</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Appointments & transport</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Resident finance subledger</span>
        </div>

              <div style={{ marginTop: "6px", fontSize: "12.5px", color: "#64768a", borderLeft: "3px solid #d7dfe8", paddingLeft: "12px" }}>Not an EHR or eMAR — CareBase runs the non-clinical operation around the chart, and routes medication events from your external source.</div>
      </div>
    </div>
        )}


        {domain === 1 && (
<div style={{ marginTop: "22px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "24px", alignItems: "start" }}>

            <div style={{ background: "#ffffff", border: "1px solid #dfe6ee", borderRadius: "14px", overflow: "hidden", boxShadow: "0 10px 30px rgba(13,39,66,0.07)" }}>

              <div style={{ padding: "12px 18px", borderBottom: "1px solid #e5eaf0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>

                <span style={{ fontWeight: "700", fontSize: "14px" }}>Compliance matrix — direct care staff</span>

                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#64768a" }}>Click any cell to edit the record</span>
        </div>

              <div style={{ padding: "16px 18px" }}>

                <div style={{ display: "grid", gridTemplateColumns: "110px repeat(5, 1fr)", gap: "6px", fontSize: "11px", alignItems: "center" }}>

                  <div></div>

                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "9.5px", color: "#64768a", textAlign: "center" }}>IN-SERVICE</div>

                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "9.5px", color: "#64768a", textAlign: "center" }}>DEMENTIA</div>

                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "9.5px", color: "#64768a", textAlign: "center" }}>PRACTICUM</div>

                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "9.5px", color: "#64768a", textAlign: "center" }}>ACT 34</div>

                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "9.5px", color: "#64768a", textAlign: "center" }}>TB SCREEN</div>

                  <div style={{ fontWeight: "600" }}>J. Miller</div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#f2d791" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>

                  <div style={{ fontWeight: "600" }}>R. Chen</div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#f2d791" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#f2d791" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>

                  <div style={{ fontWeight: "600" }}>T. Brooks</div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#e8a99f" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#f2d791" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>

                  <div style={{ fontWeight: "600" }}>A. Novak</div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>

                  <div style={{ fontWeight: "600" }}>D. Ferraro</div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#f2d791" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
                  <div style={{ height: "24px", borderRadius: "6px", background: "#bfe3c6" }}></div>
          </div>

                <div style={{ marginTop: "14px", display: "flex", gap: "16px", fontSize: "11.5px", color: "#64768a", alignItems: "center" }}>

                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: "#bfe3c6" }}></span>Current</span>

                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: "#f2d791" }}></span>Due soon</span>

                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: "#e8a99f" }}></span>Overdue — retraining assigned</span>
          </div>
        </div>

              <div style={{ padding: "12px 18px", borderTop: "1px solid #eef2f6", background: "#fafbfc", fontSize: "12px", color: "#64768a" }}>One pass-meds roster cross-checks certification, this year's practicum, and insulin authorization into a single yes/no per aide.</div>
      </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

              <h3 style={{ margin: "0", fontSize: "18px", fontWeight: "800", color: "#0d2742" }}>Hire to qualified, on its own clock</h3>

              <p style={{ margin: "0 0 4px", fontSize: "14px", color: "#44566b" }}>Every requirement a new hire needs — training, clearances, screenings, competencies — routed and tracked automatically by role and facility type.</p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Training plans by role</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Live classes · QR check-in</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>AI-drafted courses, human-approved</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Act 34 / 73 / 33 clearances</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Monthly OIG exclusion screening</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Pass-meds roster</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Shift scheduling & auto-fill</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Policy attestations</span>
        </div>

              <div style={{ marginTop: "6px", fontSize: "12.5px", color: "#64768a", borderLeft: "3px solid #d7dfe8", paddingLeft: "12px" }}>AI-touched training content can't publish until a named reviewer signs off — and the sign-off clears if any block is regenerated.</div>
      </div>
    </div>
        )}


        {domain === 2 && (
<div style={{ marginTop: "22px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "24px", alignItems: "start" }}>

            <div style={{ background: "#ffffff", border: "1px solid #dfe6ee", borderRadius: "14px", overflow: "hidden", boxShadow: "0 10px 30px rgba(13,39,66,0.07)" }}>

              <div style={{ padding: "12px 18px", borderBottom: "1px solid #e5eaf0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>

                <span style={{ fontWeight: "700", fontSize: "14px" }}>Open facility work — this week</span>

                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#64768a" }}>4 items · 1 needs verification</span>
        </div>

              <div style={{ display: "flex", flexDirection: "column" }}>

                <div style={{ padding: "13px 18px", borderBottom: "1px solid #eef2f6", display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "center" }}>

                  <div>
                    <div style={{ fontWeight: "600", fontSize: "13.5px" }}>INC-114 · Fall, witnessed — no injury</div>
                    <div style={{ fontSize: "12px", color: "#64768a" }}>State hotline notified 2h ago · investigation open · report PDF drafted</div></div>

                  <span style={{ background: "#fdf4e3", color: "#8a5a00", borderRadius: "99px", padding: "3px 10px", fontSize: "11.5px", fontWeight: "700", whiteSpace: "nowrap" }}>Follow-up due 48h</span>
          </div>

                <div style={{ padding: "13px 18px", borderBottom: "1px solid #eef2f6", display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "center" }}>

                  <div>
                    <div style={{ fontWeight: "600", fontSize: "13.5px" }}>Fire drill — 2nd shift, east wing</div>
                    <div style={{ fontSize: "12px", color: "#64768a" }}>Evacuation 4m 12s · every §2600.132 field logged · PDF filed</div></div>

                  <span style={{ background: "#eaf6ec", color: "#1e7a35", borderRadius: "99px", padding: "3px 10px", fontSize: "11.5px", fontWeight: "700", whiteSpace: "nowrap" }}>Complete</span>
          </div>

                <div style={{ padding: "13px 18px", borderBottom: "1px solid #eef2f6", display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "center" }}>

                  <div>
                    <div style={{ fontWeight: "600", fontSize: "13.5px" }}>WO-58 · Generator monthly load test</div>
                    <div style={{ fontSize: "12px", color: "#64768a" }}>Vendor on-site Thu · fuel level recorded · photos attached</div></div>

                  <span style={{ background: "#e5effa", color: "#14548f", borderRadius: "99px", padding: "3px 10px", fontSize: "11.5px", fontWeight: "700", whiteSpace: "nowrap" }}>Verify to close</span>
          </div>

                <div style={{ padding: "13px 18px", display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "center" }}>

                  <div>
                    <div style={{ fontWeight: "600", fontSize: "13.5px" }}>POC · §2600.65(a) training citation</div>
                    <div style={{ fontSize: "12px", color: "#64768a" }}>Evidence attached for follow-up visit · Plan of Correction PDF generated</div></div>

                  <span style={{ background: "#fdf4e3", color: "#8a5a00", borderRadius: "99px", padding: "3px 10px", fontSize: "11.5px", fontWeight: "700", whiteSpace: "nowrap" }}>POC submitted</span>
          </div>
        </div>

              <div style={{ padding: "12px 18px", borderTop: "1px solid #eef2f6", background: "#fafbfc", fontSize: "12px", color: "#64768a" }}>Nothing closes without an owner, a deadline, and supervisor verification — a warning becomes completed work, not another unresolved alert.</div>
      </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

              <h3 style={{ margin: "0", fontSize: "18px", fontWeight: "800", color: "#0d2742" }}>The building, on the record too</h3>

              <p style={{ margin: "0 0 4px", fontSize: "14px", color: "#44566b" }}>Incidents, drills, repairs, complaints, and emergencies each generate their own survey-ready PDF trail.</p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Incidents & notification clocks</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Violations & plans of correction</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Fire drills & life-safety logs</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Emergency operations</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Maintenance work orders</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Complaints & resident rights</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>QAPI projects</span>
        </div>

              <div style={{ marginTop: "6px", fontSize: "12.5px", color: "#64768a", borderLeft: "3px solid #d7dfe8", paddingLeft: "12px" }}>Reportable incidents auto-schedule the required notifications — state hotline, law enforcement, licensing — each with its own due-by clock.</div>
      </div>
    </div>
        )}


        {domain === 3 && (
<div style={{ marginTop: "22px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "24px", alignItems: "start" }}>

            <div style={{ background: "#ffffff", border: "1px solid #dfe6ee", borderRadius: "14px", overflow: "hidden", boxShadow: "0 10px 30px rgba(13,39,66,0.07)" }}>

              <div style={{ padding: "12px 18px", borderBottom: "1px solid #e5eaf0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>

                <span style={{ fontWeight: "700", fontSize: "14px" }}>Survey readiness — Maple Grove</span>

                <span style={{ background: "#eaf6ec", color: "#1e7a35", fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700", borderRadius: "99px", padding: "3px 10px" }}>Score 94 / 100</span>
        </div>

              <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

                <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>

                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a" }}>BINDER CONTENTS · LIVE</div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                    <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Training compliance & certificates</div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                    <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Credentials & clearances</div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                    <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Medication practicums</div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                    <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Resident assessments</div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                    <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Incidents & plans of correction</div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                    <span style={{ color: "#8a5a00", fontWeight: "800" }}>→</span>
                    <span>Fire drills —
                      <span style={{ color: "#8a5a00", fontWeight: "600" }}>1 sleeping-hours drill due</span></span></div>
          </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "10.5px", letterSpacing: "0.08em", color: "#64768a" }}>CITATION-WEIGHTED RISK</div>

                  <div style={{ fontSize: "12.5px", color: "#44566b" }}>Topics surface in the order DHS actually cites them — the most-cited regulation your facility is exposed on appears first.</div>

                  <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>

                    <span style={{ background: "#0d2742", color: "#ffffff", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", fontWeight: "700", textAlign: "center" }}>Generate binder PDF</span>

                    <div style={{ fontSize: "11.5px", color: "#64768a", textAlign: "center" }}>Rebuilt from live records · delivered via short-lived secure link</div>
            </div>
          </div>
        </div>

              <div style={{ padding: "12px 18px", borderTop: "1px solid #eef2f6", background: "#fafbfc", fontSize: "12px", color: "#64768a" }}>Auditors and surveyors get read-only, time-limited evidence rooms — never edit access, never the whole application.</div>
      </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

              <h3 style={{ margin: "0", fontSize: "18px", fontWeight: "800", color: "#0d2742" }}>Ready before the entrance conference</h3>

              <p style={{ margin: "0 0 4px", fontSize: "14px", color: "#44566b" }}>Proof is collected as work happens, so the binder is an export — not a project.</p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>One-click binder PDF</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Citation-weighted readiness score</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Ch. 2600 / 2800 crosswalk</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Time-limited evidence rooms</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Immutable audit trail</span>

                <span style={{ background: "#ffffff", border: "1px solid #dbe3ec", borderRadius: "99px", padding: "5px 12px", fontSize: "12.5px", fontWeight: "600", color: "#33465c" }}>Report center</span>
        </div>

              <div style={{ marginTop: "6px", fontSize: "12.5px", color: "#64768a", borderLeft: "3px solid #d7dfe8", paddingLeft: "12px" }}>60+ printable survey-readiness forms included, adapted from a real PA survey readiness binder.</div>
      </div>
    </div>
        )}
  </div>
</section>


    <section style={{ background: "#f6f8fa", borderBottom: "1px solid #e5eaf0" }}>

      <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "64px 24px" }}>

        <h2 style={{ margin: "0 0 28px", fontSize: "28px", fontWeight: "800", letterSpacing: "-0.02em", color: "#0d2742", textAlign: "center" }}>Facilities don't fail surveys for lack of training.
          <br />They fail to find the proof.</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "14px" }}>

          <div style={{ border: "1px solid #e5eaf0", borderRadius: "12px", padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>

            <div style={{ fontSize: "13.5px", color: "#8a99a8", textDecoration: "line-through" }}>Sign-in sheets reconciled once a year</div>

            <div style={{ fontSize: "14px", fontWeight: "700", color: "#0d2742" }}>Hours logged as training happens</div>
      </div>

          <div style={{ border: "1px solid #e5eaf0", borderRadius: "12px", padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>

            <div style={{ fontSize: "13.5px", color: "#8a99a8", textDecoration: "line-through" }}>Binder night before the survey</div>

            <div style={{ fontSize: "14px", fontWeight: "700", color: "#0d2742" }}>Binder PDF generated from live records</div>
      </div>

          <div style={{ border: "1px solid #e5eaf0", borderRadius: "12px", padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>

            <div style={{ fontSize: "13.5px", color: "#8a99a8", textDecoration: "line-through" }}>Expirations discovered by the surveyor</div>

            <div style={{ fontSize: "14px", fontWeight: "700", color: "#0d2742" }}>Alerts escalate before anything lapses</div>
      </div>

          <div style={{ border: "1px solid #e5eaf0", borderRadius: "12px", padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>

            <div style={{ fontSize: "13.5px", color: "#8a99a8", textDecoration: "line-through" }}>Nine spreadsheets, one person who gets them</div>

            <div style={{ fontSize: "14px", fontWeight: "700", color: "#0d2742" }}>One record every role works from</div>
      </div>
    </div>
  </div>
</section>


    <section style={{ background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>

      <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "72px 24px" }}>

        <div style={{ maxWidth: "640px", display: "flex", flexDirection: "column", gap: "10px" }}>

          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700", letterSpacing: "0.14em", textTransform: "uppercase", color: "#1b6fc2" }}>What sets it apart</span>

          <h2 style={{ margin: "0", fontSize: "32px", fontWeight: "700", letterSpacing: "-0.01em", color: "#0d2742", textWrap: "balance" }}>Four things you won't find in a training portal</h2>
    </div>

        <div style={{ marginTop: "32px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "16px" }}>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 6px 20px rgba(13,39,66,0.04)" }}>

            <h3 style={{ margin: "0", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>AI course creation with a human gate</h3>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>Paste a regulation, policy, or reference document and CareBase drafts the complete course — modules, lesson text or video scripts, and graded quizzes — grounded strictly in your source. It flags gaps instead of inventing citations.</p>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>Add an AI avatar presenter video if you want one. Nothing publishes until a named reviewer signs off — and the sign-off clears automatically the moment any block is regenerated.</p>

            <div style={{ marginTop: "auto", fontFamily: "ui-monospace, monospace", fontSize: "11px", letterSpacing: "0.08em", color: "#1b6fc2", borderTop: "1px solid #eef2f6", paddingTop: "12px" }}>REVIEWED BY A REAL PERSON, EVERY TIME</div>
      </div>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 6px 20px rgba(13,39,66,0.04)" }}>

            <h3 style={{ margin: "0", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>Citation-weighted readiness score</h3>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>A live, per-facility score weighted by how often DHS actually cites each regulation — not a generic checklist percentage.</p>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>Training, credentials, background checks, inspections, incidents, and policy attestations roll into one number, sorted so your most-citable exposure surfaces first.</p>

            <div style={{ marginTop: "auto", fontFamily: "ui-monospace, monospace", fontSize: "11px", letterSpacing: "0.08em", color: "#1b6fc2", borderTop: "1px solid #eef2f6", paddingTop: "12px" }}>SEE WHAT THE SURVEYOR WILL FLAG, FIRST</div>
      </div>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 6px 20px rgba(13,39,66,0.04)" }}>

            <h3 style={{ margin: "0", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>Live pass-meds authorization roster</h3>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>The question a surveyor asks on-site: who is authorized to administer medications
              <em>right now</em>?</p>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>One roster cross-checks each employee's medication-administration certification, current-year practicum, and insulin authorization into a single yes or no.</p>

            <div style={{ marginTop: "auto", fontFamily: "ui-monospace, monospace", fontSize: "11px", letterSpacing: "0.08em", color: "#1b6fc2", borderTop: "1px solid #eef2f6", paddingTop: "12px" }}>ONE ANSWER PER EMPLOYEE, ALWAYS CURRENT</div>
      </div>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 6px 20px rgba(13,39,66,0.04)" }}>

            <h3 style={{ margin: "0", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>Paperless live-class attendance</h3>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>Each class shows a QR code that rotates every 30 seconds — staff scan with their own phones, or a shared kiosk takes name and PIN. No app installs.</p>

            <p style={{ margin: "0", fontSize: "14px", color: "#44566b" }}>A printable meeting notice with an embedded QR and a backup paper table covers anyone who can't scan; upload the completed sheet back into the class record.</p>

            <div style={{ marginTop: "auto", fontFamily: "ui-monospace, monospace", fontSize: "11px", letterSpacing: "0.08em", color: "#1b6fc2", borderTop: "1px solid #eef2f6", paddingTop: "12px" }}>HOURS COUNT THE MOMENT THEY SIGN IN</div>
      </div>
    </div>
  </div>
</section>


    <section style={{ background: "linear-gradient(120deg, #1b6fc2, #143a5c)", color: "#ffffff" }}>

      <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "36px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px", flexWrap: "wrap" }}>

        <div>

          <div style={{ fontSize: "20px", fontWeight: "700", fontFamily: "'Source Serif 4', Georgia, serif" }}>Seen enough to be curious?</div>

          <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.85)", marginTop: "3px" }}>Import your roster this afternoon — the trial is self-serve and every module is included.</div>
    </div>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>

          <a href="#pricing" style={{ background: "#ffffff", color: "#0d2742", fontWeight: "700", fontSize: "14.5px", padding: "12px 20px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[#dcebfa] hover:no-underline">Start free trial</a>

          <Link href="/features" style={{ border: "1px solid rgba(255,255,255,0.45)", color: "#ffffff", fontWeight: "700", fontSize: "14.5px", padding: "12px 20px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[rgba(255,255,255,0.12)] hover:no-underline">See all 50+ capabilities</Link>
    </div>
  </div>
</section>


    <section id="pricing" style={{ scrollMarginTop: "72px", background: "#ffffff", borderBottom: "1px solid #e5eaf0" }}>

      <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "72px 24px" }}>

        <div style={{ textAlign: "center", maxWidth: "560px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "10px" }}>

          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700", letterSpacing: "0.14em", textTransform: "uppercase", color: "#1b6fc2" }}>Pricing</span>

          <h2 style={{ margin: "0", fontSize: "30px", fontWeight: "800", letterSpacing: "-0.02em", color: "#0d2742" }}>Priced per facility. Every module included.</h2>

          <p style={{ margin: "0", color: "#44566b", fontSize: "15px" }}>No per-seat math, no module upsells. Unlimited employees and residents on every plan.</p>
    </div>

        <div style={{ marginTop: "36px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "16px", alignItems: "stretch" }}>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "14px" }}>

            <div style={{ fontWeight: "800", fontSize: "16px", color: "#0d2742" }}>Single facility</div>

            <div>
              <span style={{ fontSize: "38px", fontWeight: "800", color: "#0d2742", letterSpacing: "-0.02em" }}>{STARTER_PRICE}</span>
              <span style={{ fontSize: "14px", color: "#64768a" }}> / facility / month</span></div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13.5px", color: "#33465c" }}>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>All modules — residents, workforce, facility, evidence</div>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Unlimited employees & residents</div>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Email + SMS alerts, binder exports</div>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Self-serve setup, CSV roster import</div>
        </div>

            <a href="#start" style={{ marginTop: "auto", textAlign: "center", border: "1px solid #c8d4e0", color: "#0d2742", fontWeight: "700", fontSize: "14px", padding: "11px 16px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[#f0f5fa] hover:no-underline">Start {TRIAL_DAYS}-day free trial</a>
      </div>

          <div style={{ border: "2px solid #1b6fc2", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "14px", position: "relative", boxShadow: "0 16px 40px rgba(27,111,194,0.12)" }}>

            <span style={{ position: "absolute", top: "-12px", left: "24px", background: "#1b6fc2", color: "#ffffff", fontSize: "11px", fontWeight: "800", letterSpacing: "0.06em", borderRadius: "99px", padding: "4px 12px" }}>MULTI-SITE</span>

            <div style={{ fontWeight: "800", fontSize: "16px", color: "#0d2742" }}>Organization · 3+ facilities</div>

            <div>
              <span style={{ fontSize: "38px", fontWeight: "800", color: "#0d2742", letterSpacing: "-0.02em" }}>{GROWTH_PRICE}</span>
              <span style={{ fontSize: "14px", color: "#64768a" }}> / facility / month</span></div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13.5px", color: "#33465c" }}>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Everything in Single facility</div>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Org-wide rollups & facility comparisons</div>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Cross-facility float staff scheduling</div>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Controlled evidence rooms for auditors</div>
        </div>

            <a href="#start" style={{ marginTop: "auto", textAlign: "center", background: "#1b6fc2", color: "#ffffff", fontWeight: "700", fontSize: "14px", padding: "12px 16px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[#14548f] hover:no-underline">Start {TRIAL_DAYS}-day free trial</a>
      </div>

          <div style={{ border: "1px solid #dfe6ee", borderRadius: "14px", padding: "26px", display: "flex", flexDirection: "column", gap: "14px", background: "#fafbfc" }}>

            <div style={{ fontWeight: "800", fontSize: "16px", color: "#0d2742" }}>Enterprise & groups</div>

            <div>
              <span style={{ fontSize: "38px", fontWeight: "800", color: "#0d2742", letterSpacing: "-0.02em" }}>Custom</span></div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13.5px", color: "#33465c" }}>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Volume pricing across 10+ facilities</div>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Guided migration & onboarding</div>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Contract, hosting & security review</div>

              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Priority support</div>
        </div>

            <a href="#start" style={{ marginTop: "auto", textAlign: "center", border: "1px solid #c8d4e0", color: "#0d2742", fontWeight: "700", fontSize: "14px", padding: "11px 16px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[#f0f5fa] hover:no-underline">Talk to us</a>
      </div>
    </div>

        <p style={{ margin: "18px auto 0", maxWidth: "640px", textAlign: "center", fontSize: "12.5px", color: "#64768a" }}>These prices feed the
          <Link href="/savings">
            <strong>savings worksheet below</strong></Link> automatically — model your net opportunity with your own coordination hours and tool spend, risk avoidance excluded.</p>
  </div>
</section>


    <section style={{ background: "#071626", color: "#ffffff" }}>

      <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "26px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px 26px", flexWrap: "wrap", fontSize: "13.5px", textAlign: "center" }}>

        <span style={{ color: "rgba(255,255,255,0.88)" }}>No guaranteed survey outcomes</span>

        <span style={{ color: "rgba(255,255,255,0.35)" }}>·</span>

        <span style={{ color: "rgba(255,255,255,0.88)" }}>No per-seat fees</span>

        <span style={{ color: "rgba(255,255,255,0.35)" }}>·</span>

        <span style={{ color: "rgba(255,255,255,0.88)" }}>Your data exports if you leave</span>

        <Link href="/how-it-works#promises" style={{ color: "#8ec8ff", fontWeight: "700" }}>Read our promises →</Link>
  </div>
</section>


    <section id="start" style={{ scrollMarginTop: "72px", background: "#f6f8fa", borderBottom: "1px solid #e5eaf0" }}>

      <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "72px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: "48px", alignItems: "start" }}>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", fontWeight: "700", letterSpacing: "0.14em", textTransform: "uppercase", color: "#1b6fc2" }}>Fully self-service</span>

          <h2 style={{ margin: "0", fontSize: "30px", fontWeight: "800", letterSpacing: "-0.02em", color: "#0d2742", textWrap: "balance" }}>Signup to survey-ready, without talking to anyone</h2>

          <p style={{ margin: "0", color: "#44566b", fontSize: "15px", textWrap: "pretty" }}>No sales call. No onboarding call. No "book time with our team." Every module is live the moment your organization exists.</p>

          <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13.5px", color: "#33465c" }}>

            <div style={{ display: "flex", gap: "10px" }}>
              <span style={{ color: "#1b6fc2", fontWeight: "800" }}>1</span>
              <span>
                <strong>Create your organization</strong> — name, facility type, admin email. About two minutes.</span></div>

            <div style={{ display: "flex", gap: "10px" }}>
              <span style={{ color: "#1b6fc2", fontWeight: "800" }}>2</span>
              <span>
                <strong>Import your roster</strong> — one CSV brings every employee in; add facilities as you go.</span></div>

            <div style={{ display: "flex", gap: "10px" }}>
              <span style={{ color: "#1b6fc2", fontWeight: "800" }}>3</span>
              <span>
                <strong>Requirements apply themselves</strong> — hour buckets, renewal windows, and alerts start from your facility type and each person's role.</span></div>

            <div style={{ display: "flex", gap: "10px" }}>
              <span style={{ color: "#1b6fc2", fontWeight: "800" }}>4</span>
              <span>
                <strong>Export your first binder</strong> — see your real compliance picture the same day.</span></div>
      </div>

          <div style={{ fontSize: "13px", color: "#64768a", marginTop: "6px" }}>Stuck on something?
            <Link href="/faq">The FAQ</Link> answers the common questions;
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> answers async — never a required call.</div>
    </div>

        <div style={{ background: "#ffffff", border: "2px solid #1b6fc2", borderRadius: "14px", padding: "28px", display: "flex", flexDirection: "column", gap: "16px", boxShadow: "0 16px 40px rgba(27,111,194,0.12)" }}>

          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "10.5px", fontWeight: "700", letterSpacing: "0.12em", color: "#1b6fc2" }}>START NOW — ALL YOU NEED</div>

          <div style={{ display: "flex", flexDirection: "column", gap: "9px", fontSize: "14px", color: "#33465c" }}>

            <div style={{ display: "flex", gap: "9px" }}>
              <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Your facility name and license type</div>

            <div style={{ display: "flex", gap: "9px" }}>
              <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>A work email for the admin account</div>

            <div style={{ display: "flex", gap: "9px" }}>
              <span style={{ color: "#1e7a35", fontWeight: "800" }}>✓</span>Optional: a roster CSV for bulk import</div>
      </div>

          <Link href="/signup" style={{ textAlign: "center", background: "#1b6fc2", color: "#ffffff", fontWeight: "700", fontSize: "15.5px", padding: "14px 16px", borderRadius: "9px", textDecoration: "none" }} className="hover:bg-[#14548f] hover:no-underline">Create your organization — free for {TRIAL_DAYS} days</Link>

          <div style={{ fontSize: "12px", color: "#8a99a8", textAlign: "center" }}>Every module included · unlimited staff · cancel in-app, export everything ·
            <Link href="/privacy">Privacy</Link></div>
    </div>
  </div>
</section>


    <section id="faq" style={{ scrollMarginTop: "72px", background: "#ffffff" }}>

      <div style={{ maxWidth: "780px", margin: "0 auto", padding: "72px 24px" }}>

        <h2 style={{ margin: "0 0 24px", fontSize: "28px", fontWeight: "800", letterSpacing: "-0.02em", color: "#0d2742", textAlign: "center" }}>Straight answers</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

          <div style={{ border: "1px solid #e5eaf0", borderRadius: "12px", padding: "18px 20px" }}>

            <div style={{ fontWeight: "800", fontSize: "15px", color: "#0d2742" }}>What is CareBase?</div>

            <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#44566b" }}>The operations, workforce-compliance, and survey-readiness platform for Pennsylvania personal care homes and assisted living facilities. Not an EHR or eMAR.</p>
      </div>

          <div style={{ border: "1px solid #e5eaf0", borderRadius: "12px", padding: "18px 20px" }}>

            <div style={{ fontWeight: "800", fontSize: "15px", color: "#0d2742" }}>How much does it cost?</div>

            <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#44566b" }}>From {GROWTH_PRICE}/facility/month for multi-site organizations, {STARTER_PRICE} for a single facility — every module, unlimited staff.
              <a href="#pricing">See pricing.</a></p>
      </div>

          <div style={{ border: "1px solid #e5eaf0", borderRadius: "12px", padding: "18px 20px" }}>

            <div style={{ fontWeight: "800", fontSize: "15px", color: "#0d2742" }}>What does it replace — and not replace?</div>

            <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#44566b" }}>Replaces training spreadsheets, paper binders, point trackers, and basic scheduling. Works alongside — never replaces — your eMAR, EHR, payroll, HRIS, and accounting.</p>
      </div>

          <div style={{ border: "1px solid #e5eaf0", borderRadius: "12px", padding: "18px 20px" }}>

            <div style={{ fontWeight: "800", fontSize: "15px", color: "#0d2742" }}>Can a surveyor or auditor get access?</div>

            <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#44566b" }}>Yes — a read-only auditor role, plus time-limited evidence rooms scoped to exactly what was requested.</p>
      </div>

          <div style={{ border: "1px solid #e5eaf0", borderRadius: "12px", padding: "18px 20px" }}>

            <div style={{ fontWeight: "800", fontSize: "15px", color: "#0d2742" }}>How fast can we start?</div>

            <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#44566b" }}>Same day. Self-serve signup creates your organization; CSV import onboards a full roster in minutes.</p>
      </div>
    </div>

        <p style={{ margin: "20px 0 0", textAlign: "center", fontSize: "14px" }}>
          <Link href="/faq" style={{ fontWeight: "700" }}>Read the full FAQ — 20+ answers →</Link></p>
  </div>
</section>


    </MarketingLayout>
  );
}
