import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { CONTACT_EMAIL } from "@/components/marketing/pricing";
import { usePageMeta } from "@/lib/usePageMeta";

export default function Privacy() {
  usePageMeta({ ...MARKETING_ROUTE_META["/privacy"], path: "/privacy" });

  return (
    <MarketingLayout>
      <section style={{ background: "#ffffff" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "56px 24px 80px", display: "flex", flexDirection: "column", gap: "22px" }}>
          <h1 style={{ margin: "0", fontSize: "36px", fontWeight: "700", letterSpacing: "-0.01em", color: "#0d2742" }}>Privacy Policy</h1>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "12px", color: "#5d7084" }}>Effective date: July 23, 2026 · Applies to CareMetric CareBase (cmcarebase.com)</div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>1. Who we are</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>CareMetric CareBase (&quot;CareBase,&quot; &quot;we&quot;) provides operations, workforce-compliance, and survey-readiness software for personal care homes, assisted living facilities, and related providers. This policy describes how we handle information when you use the service or visit this site.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>2. Information we collect</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}><strong>Account information:</strong> name, work email, organization, and role for each user your organization creates. <strong>Records your organization enters:</strong> employee training, credential, and screening records; resident operational and assessment records; facility, incident, scheduling, and document data. <strong>Usage and technical data:</strong> log data, device and browser information, and audit events (including the signer metadata captured for policy attestations). <strong>Communications:</strong> messages you send us, and delivery logs for alerts we send on your organization's behalf.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>3. How we use information</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>To provide and secure the service; to deliver alerts, reminders, and reports your organization configures; to provide support; to maintain audit and compliance evidence; and to improve the product. We do not sell personal information and we do not use resident or employee records for advertising.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>4. Your organization controls its data</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>Your organization is the controller of the records it enters; CareBase processes them to provide the service. Access within the service is scoped by organization, facility, and role, enforced at the database layer. Individuals seeking access to or correction of records held by a facility should contact that facility's administrator.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>5. Storage and security</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>Data is stored with established cloud infrastructure providers. Documents and certificates live in private storage accessed through short-lived signed links; traffic is encrypted in transit; compliance-determining actions are written to an immutable audit log. No system is perfectly secure — see the <Link href="/security">security overview</Link> for the controls you can verify.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>6. Sharing and subprocessors</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>We share data only with service providers needed to operate CareBase — cloud hosting and database infrastructure, and email/SMS delivery providers for the notifications your organization enables — under agreements limiting their use of the data. We may disclose information when required by law. A current subprocessor list is available on request at {CONTACT_EMAIL}.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>7. Retention and deletion</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>Records are retained while your organization's account is active and as needed for its regulatory retention obligations. On termination, your organization may export its data; we delete or de-identify it after a wind-down period, except where retention is required by law.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>8. Children</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>The service is for use by care organizations and their staff; it is not directed to children under 13.</p></div>

          <div><h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700", color: "#0d2742" }}>9. Changes and contact</h2><p style={{ margin: "0", fontSize: "14.5px", color: "#33465c" }}>We will post changes to this policy here with an updated effective date. Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p></div>
        </div>
      </section>
    </MarketingLayout>
  );
}
