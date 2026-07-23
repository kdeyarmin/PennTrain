import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { Reveal } from "@/components/marketing/primitives";
import { usePageMeta } from "@/lib/usePageMeta";
import { Link } from "wouter";

const TERMS_SECTIONS = [
  {
    title: "1. The service",
    body:
      "CareBase is subscription software for facility operations, workforce compliance, and survey-readiness evidence. It is not an EHR, eMAR, payroll, or accounting system, and it does not provide legal, clinical, or regulatory advice.",
  },
  {
    title: "2. Accounts",
    body:
      "Your organization is responsible for its users, the accuracy of information entered, and maintaining the confidentiality of credentials. You must be authorized to act for the organization you register.",
  },
  {
    title: "3. Subscriptions and billing",
    body:
      "Plans are priced per facility per month and include a free trial period. Subscriptions renew until canceled; cancellation takes effect at the end of the current billing term. Pilot-program terms, when offered, are set in the pilot agreement.",
  },
  {
    title: "4. Your data",
    body: (
      <>
        Your organization owns the records it enters. You grant us the rights
        needed to host, process, back up, and display that data to your
        authorized users. You are responsible for having the lawful right to
        enter employee and resident information and for your regulatory
        retention obligations. Data handling is described in the{" "}
        <Link href="/privacy" className="font-semibold text-primary hover:underline">
          Privacy Policy
        </Link>
        .
      </>
    ),
  },
  {
    title: "5. Acceptable use",
    body:
      "No unlawful use, no attempting to circumvent access controls or audit logging, no reselling the service, and no entering data you lack the right to process.",
  },
  {
    title: "6. Compliance disclaimer",
    body:
      "CareBase helps you track requirements and preserve evidence. It does not guarantee regulatory compliance, survey outcomes, or the sufficiency of any record. Official forms, professional judgment, and compliance itself remain your organization's responsibility. Dashboards and AI-assisted tools are decision support, not legal advice.",
  },
  {
    title: "7. AI features",
    body:
      "AI-drafted content is generated from the materials you provide and must be reviewed and approved by your named reviewer before use. You are responsible for validating AI outputs before relying on them.",
  },
  {
    title: "8. Availability, warranty, and liability",
    body:
      "The service is provided \"as is.\" We work to keep it available and backed up but do not warrant uninterrupted operation. To the maximum extent permitted by law, our aggregate liability is limited to the fees your organization paid in the twelve months before the claim, and neither party is liable for indirect or consequential damages.",
  },
  {
    title: "9. Termination",
    body:
      "Either party may terminate per the subscription terms; we may suspend accounts for material breach. After termination your organization has a wind-down window to export its data, after which it is deleted or de-identified except where retention is required by law.",
  },
  {
    title: "10. Governing law; changes; contact",
    body: (
      <>
        These terms are governed by the laws of the Commonwealth of
        Pennsylvania. We will post updates here with a new effective date;
        material changes will be notified to org admins. Questions:{" "}
        <a className="font-semibold text-primary hover:underline" href="mailto:hello@caremetric.ai">
          hello@caremetric.ai
        </a>
        .
      </>
    ),
  },
] as const;

export default function Terms() {
  usePageMeta({ ...MARKETING_ROUTE_META["/terms"], path: "/terms" });

  return (
    <MarketingLayout>
      <section className="bg-white">
        <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <Reveal>
            <div className="rounded-[10px] border border-[#f0d9a8] bg-[#fdf7ea] px-4 py-3 text-[13px] font-semibold text-[#6d5312]">
              DRAFT — have counsel review and finalize before publishing.
            </div>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="font-serif text-4xl font-bold tracking-tight text-[#0d2742]">
              Terms of Service
            </h1>
            <p className="mt-3 font-mono text-xs text-[#5d7084]">
              Effective date: [DATE] · Applies to CareMetric CareBase
              (cmcarebase.com)
            </p>
          </Reveal>

          {TERMS_SECTIONS.map((section, index) => (
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
