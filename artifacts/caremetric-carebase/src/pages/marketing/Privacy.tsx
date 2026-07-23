import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { Reveal } from "@/components/marketing/primitives";
import { usePageMeta } from "@/lib/usePageMeta";
import { Link } from "wouter";

const PRIVACY_SECTIONS = [
  {
    title: "1. Who we are",
    body: (
      <>
        CareMetric CareBase (&quot;CareBase,&quot; &quot;we&quot;) provides operations,
        workforce-compliance, and survey-readiness software for personal care
        homes, Assisted Living Facilities, and related providers. This policy
        describes how we handle information when you use the service or visit
        this site.
      </>
    ),
  },
  {
    title: "2. Information we collect",
    body: (
      <>
        <strong>Account information:</strong> name, work email, organization,
        and role for each user your organization creates. <strong>Records your
        organization enters:</strong> employee training, credential, and screening
        records; resident operational and assessment records; facility,
        incident, scheduling, and document data. <strong>Usage and technical
        data:</strong> log data, device and browser information, and audit events
        (including the signer metadata captured for policy attestations).{" "}
        <strong>Communications:</strong> messages you send us, and delivery logs
        for alerts we send on your organization&apos;s behalf.
      </>
    ),
  },
  {
    title: "3. How we use information",
    body:
      "To provide and secure the service; to deliver alerts, reminders, and reports your organization configures; to provide support; to maintain audit and compliance evidence; and to improve the product. We do not sell personal information and we do not use resident or employee records for advertising.",
  },
  {
    title: "4. Your organization controls its data",
    body:
      "Your organization is the controller of the records it enters; CareBase processes them to provide the service. Access within the service is scoped by organization, facility, and role, enforced at the database layer. Individuals seeking access to or correction of records held by a facility should contact that facility's administrator.",
  },
  {
    title: "5. Storage and security",
    body: (
      <>
        Data is stored with established cloud infrastructure providers.
        Documents and certificates live in private storage accessed through
        short-lived signed links; traffic is encrypted in transit;
        compliance-determining actions are written to an immutable audit log. No
        system is perfectly secure — see the{" "}
        <Link href="/security" className="font-semibold text-primary hover:underline">
          security overview
        </Link>{" "}
        for the controls you can verify.
      </>
    ),
  },
  {
    title: "6. Sharing and subprocessors",
    body:
      "We share data only with service providers needed to operate CareBase — cloud hosting and database infrastructure, and email/SMS delivery providers for the notifications your organization enables — under agreements limiting their use of the data. We may disclose information when required by law. A current subprocessor list is available on request at hello@caremetric.ai.",
  },
  {
    title: "7. Retention and deletion",
    body:
      "Records are retained while your organization's account is active and as needed for its regulatory retention obligations. On termination, your organization may export its data; we delete or de-identify it after a wind-down period, except where retention is required by law.",
  },
  {
    title: "8. Children",
    body:
      "The service is for use by care organizations and their staff; it is not directed to children under 13.",
  },
  {
    title: "9. Changes and contact",
    body: (
      <>
        We will post changes to this policy here with an updated effective date.
        Questions:{" "}
        <a className="font-semibold text-primary hover:underline" href="mailto:hello@caremetric.ai">
          hello@caremetric.ai
        </a>
        .
      </>
    ),
  },
] as const;

export default function Privacy() {
  usePageMeta({ ...MARKETING_ROUTE_META["/privacy"], path: "/privacy" });

  return (
    <MarketingLayout>
      <section className="bg-white">
        <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <Reveal>
            <h1 className="font-serif text-4xl font-bold tracking-tight text-[#0d2742]">
              Privacy Policy
            </h1>
            <p className="mt-3 font-mono text-xs text-[#5d7084]">
              Effective date: July 23, 2026 · Applies to CareMetric CareBase
              (cmcarebase.com)
            </p>
          </Reveal>

          {PRIVACY_SECTIONS.map((section, index) => (
            <Reveal key={section.title} delay={Math.min(index * 0.03, 0.18)}>
              <section className="space-y-2">
                <h2 className="font-serif text-xl font-bold text-[#0d2742]">
                  {section.title}
                </h2>
                <p className="text-[14.5px] leading-6 text-[#33465c]">
                  {section.body}
                </p>
              </section>
            </Reveal>
          ))}
        </div>
      </section>
    </MarketingLayout>
  );
}
