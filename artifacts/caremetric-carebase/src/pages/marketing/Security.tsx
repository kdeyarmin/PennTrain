import {
  ClipboardCheck,
  Database,
  FileLock2,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Reveal, TechGrid, TechIcon } from "@/components/marketing/primitives";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

const SECURITY_CONTROLS = [
  {
    icon: Database,
    title: "Row-level security by design",
    description:
      "Organization, facility, role, and record-scope rules are enforced by Postgres Row-Level Security at the database boundary — not just in the interface.",
  },
  {
    icon: UserCheck,
    title: "Six enforced access levels",
    description:
      "Platform admin, org admin, facility manager, trainer, employee, and auditor — each scoped to exactly the data their role should touch.",
  },
  {
    icon: FileLock2,
    title: "Private storage, signed URLs",
    description:
      "Documents, certificates, sign-in sheets, and binders live in private storage, accessed only through short-lived signed links.",
  },
  {
    icon: ShieldCheck,
    title: "Immutable audit trail",
    description:
      "Compliance-determining actions — quiz grading, certificate issuance, course publishing — are logged and can't be altered after the fact.",
  },
  {
    icon: ClipboardCheck,
    title: "Human review required for AI content",
    description:
      "AI-touched training content can't go live until a named reviewer signs off — and the approval clears automatically the moment any section is regenerated.",
  },
  {
    icon: KeyRound,
    title: "Audited support impersonation",
    description:
      "Support sign-in-as-user requires a written reason, can't target another admin or a deactivated account, and every session start and end is immutably logged.",
  },
  {
    icon: Fingerprint,
    title: "Version-bound e-signature evidence",
    description:
      "Policy attestations capture the signer, timestamp, IP, user agent, and a content hash of the exact document version reviewed — designed to support ESIGN/UETA recordkeeping.",
  },
  {
    icon: LockKeyhole,
    title: "Hashed, never-plaintext secrets",
    description:
      "Class check-in PINs are bcrypt-hashed at rest and verified inside the database — the plaintext value is never stored.",
  },
] as const;

const DEMO_TESTS = [
  'Can a facility manager only reach assigned-facility records — and does an out-of-scope facility show "Not Assigned," never a false all-clear?',
  "Can an employee see their own training without seeing coworker credentials?",
  "Can an auditor review evidence without the ability to change it?",
  "Can support impersonation, AI review, certificate issuance, and policy signatures be audited afterward?",
] as const;

const DUE_DILIGENCE_AREAS = [
  {
    title: "Identity & access",
    description:
      "Role permissions, org and facility scope, employee self-service boundaries, MFA support, and auditor read-only behavior.",
  },
  {
    title: "Evidence & file handling",
    description:
      "Private storage, short-lived access links, controlled evidence sharing, record ownership, and file access boundaries.",
  },
  {
    title: "Operational controls",
    description:
      "Database-enforced policies, approval and review gates, audit events, support access, and out-of-scope facility behavior.",
  },
  {
    title: "Deployment & contract",
    description:
      "Hosting responsibility, backups, recovery, retention and deletion, incident response, subprocessors, and any required agreement or certification.",
  },
] as const;

export default function Security() {
  usePageMeta({ ...MARKETING_ROUTE_META["/security"], path: "/security" });

  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="relative mx-auto flex max-w-[860px] flex-col items-center gap-4 px-6 py-16 text-center">
          <span className="inline-flex rounded-full border border-white/20 bg-white/[0.08] px-3.5 py-1.5 text-xs font-bold text-[#b9e4ff]">
            Security & trust
          </span>
          <h1 className="m-0 text-balance text-[42px] font-bold leading-[1.1] tracking-[-0.015em] max-sm:text-4xl">
            Security controls you can verify in the product
          </h1>
          <p className="m-0 max-w-[54ch] text-pretty text-[17px] text-white/85">
            Your residents’ and staff’s records are safer here than in a filing
            cabinet or a shared drive: every boundary is enforced at the
            database, every sensitive action is logged, and every claim below is
            something you can test yourself in the free trial.
          </p>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#071626] text-white">
        <div className="mx-auto max-w-[1160px] px-6 py-14">
          <h2 className="sr-only">Security controls</h2>
          <div className="grid gap-3.5 md:grid-cols-2">
            {SECURITY_CONTROLS.map((control, index) => (
              <Reveal key={control.title} delay={(index % 2) * 0.05}>
                <article className="flex h-full gap-4 rounded-xl border border-white/15 bg-white/[0.055] p-[22px]">
                  <TechIcon icon={control.icon} />
                  <div>
                    <h3 className="text-[15px] font-bold text-[#b9e4ff]">
                      {control.title}
                    </h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-white/80">
                      {control.description}
                    </p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto grid max-w-[1160px] items-start gap-10 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal className="flex flex-col gap-3">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">
              Test it yourself
            </span>
            <h2 className="m-0 text-balance text-[28px] font-bold leading-tight tracking-[-0.01em] text-[#0d2742]">
              Four things to test in any system — ours included
            </h2>
            <p className="m-0 text-[14.5px] text-[#44566b]">
              Trust claims should translate into access behavior you can watch
              happen.
            </p>
          </Reveal>

          <Reveal delay={0.08} className="flex flex-col gap-2.5">
            {DEMO_TESTS.map((test) => (
              <div
                key={test}
                className="rounded-xl border border-[#dfe6ee] px-[18px] py-3.5 text-sm text-[#33465c]"
              >
                {test}
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-[#f6f8fa]">
        <div className="mx-auto max-w-[1160px] px-6 py-16">
          <Reveal className="flex max-w-[640px] flex-col gap-2.5">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">
              Buyer due diligence
            </span>
            <h2 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.01em] text-[#0d2742]">
              Evaluate product controls and deployment obligations separately
            </h2>
          </Reveal>

          <div className="mt-6 grid gap-3.5 md:grid-cols-2">
            {DUE_DILIGENCE_AREAS.map((area, index) => (
              <Reveal key={area.title} delay={(index % 2) * 0.05}>
                <article className="h-full rounded-xl border border-[#dfe6ee] bg-white p-5">
                  <h3 className="text-[14.5px] font-bold text-[#0d2742]">
                    {area.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] text-[#44566b]">
                    {area.description}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-[18px] rounded-[10px] border border-[#f0d9a8] bg-[#fdf7ea] px-[18px] py-3.5 text-[13px] text-[#6d5312]">
            These product controls are not, by themselves, a claim of a
            particular certification, a signed business associate agreement, or
            compliance for every deployment. Confirm the hosted environment,
            contract, retention requirements, and organizational safeguards that
            apply to your use.
          </Reveal>
        </div>
      </section>

      <section className="bg-[#071626] text-white">
        <div className="mx-auto flex max-w-[860px] flex-col items-center gap-3.5 px-6 py-14 text-center">
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.01em]">
            Give your security reviewer their own login
          </h2>
          <p className="m-0 max-w-[52ch] text-[15px] text-white/85">
            Create a trial organization and let them probe every boundary
            themselves. Hosting and contract documentation is available for
            download.
          </p>
          <Button
            asChild
            className="mt-1.5 bg-white px-5 py-3 text-[14.5px] font-bold text-[#0d2742] hover:bg-[#dcebfa]"
          >
            <Link href="/signup">Start a free trial</Link>
          </Button>
        </div>
      </section>
    </MarketingLayout>
  );
}
