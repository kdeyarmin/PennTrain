import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { CONTACT_EMAIL } from "@/components/marketing/pricing";
import { usePageMeta } from "@/lib/usePageMeta";

export default function Terms() {
  usePageMeta({ ...MARKETING_ROUTE_META["/terms"], path: "/terms" });

  return (
    <MarketingLayout>
      <section style={{ background: "#ffffff" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "56px 24px 80px", display: "flex", flexDirection: "column", gap: "22px" }}>
          <h1 style={{ margin: "0", fontSize: "36px", fontWeight: "700", letterSpacing: "-0.01em", color: "#0d2742" }}>Terms of Service</h1>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "12px", color: "#5d7084" }}>Effective date: July 23, 2026 · Applies to CareMetric CareBase (cmcarebase.com)</div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>1. The service</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>CareBase is subscription software for facility operations, workforce compliance, and survey-readiness evidence. It is not an EHR, eMAR, payroll, or accounting system, and it does not provide legal, clinical, or regulatory advice.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>2. Accounts</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>Your organization is responsible for its users, the accuracy of information entered, and maintaining the confidentiality of credentials. You must be authorized to act for the organization you register.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>3. Subscriptions and billing</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>Plans are priced per facility per month and include a free trial period. Subscriptions renew until canceled; cancellation takes effect at the end of the current billing term.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>4. Your data</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>Your organization owns the records it enters. You grant us the rights needed to host, process, back up, and display that data to your authorized users. You are responsible for having the lawful right to enter employee and resident information and for your regulatory retention obligations. Data handling is described in the <Link href="/privacy">Privacy Policy</Link>.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>5. Acceptable use</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>No unlawful use, no attempting to circumvent access controls or audit logging, no reselling the service, and no entering data you lack the right to process.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>6. Compliance disclaimer</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>CareBase helps you track requirements and preserve evidence. It does not guarantee regulatory compliance, survey outcomes, or the sufficiency of any record. Official forms, professional judgment, and compliance itself remain your organization's responsibility. Dashboards and AI-assisted tools are decision support, not legal advice.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>7. AI features</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>AI-drafted content is generated from the materials you provide and must be reviewed and approved by your named reviewer before use. You are responsible for validating AI outputs before relying on them.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>8. Availability, warranty, and liability</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>The service is provided &quot;as is.&quot; We work to keep it available and backed up but do not warrant uninterrupted operation. To the maximum extent permitted by law, our aggregate liability is limited to the fees your organization paid in the twelve months before the claim, and neither party is liable for indirect or consequential damages.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>9. Termination</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>Either party may terminate per the subscription terms; we may suspend accounts for material breach. After termination your organization has a wind-down window to export its data, after which it is deleted or de-identified except where retention is required by law.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>10. Governing law; changes; contact</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>These terms are governed by the laws of the Commonwealth of Pennsylvania. We will post updates here with a new effective date; material changes will be notified to org admins. Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p></div>
        </div>
      </section>
    </MarketingLayout>
  );
}
