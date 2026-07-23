import { ArrowRight, ExternalLink, Printer, XCircle } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/lib/usePageMeta";

const SUMMARY_ROWS = [
  {
    setting: "Personal care home",
    requirement:
      "12 hrs per direct care worker (≤6 may be on-the-job) · +6 hrs on a secured dementia unit",
    citation: "§2600.65 / .236",
  },
  {
    setting: "Assisted Living Facility",
    requirement:
      "16 hrs per direct care worker · +4 dementia hrs within 30 days of hire, 2 hrs yearly after (do not count toward the 16) · 8 hrs on a special care unit",
    citation: "§2800.65 / .69 / .236",
  },
  {
    setting: "Chapter 6400 community home",
    requirement:
      "24 hrs — direct service workers, their supervisors, program specialists · 12 hrs for specified other roles",
    citation: "§6400.52",
  },
  {
    setting: "Nursing home",
    requirement:
      "12 hrs per nurse aide, tailored to the most recent performance review and facility assessment",
    citation: "42 CFR 483.95",
  },
  {
    setting: "Home health agency",
    requirement: "12 hrs per aide, RN-supervised and documented",
    citation: "42 CFR 484.80",
  },
  {
    setting: "Hospice agency",
    requirement:
      "12 hrs per aide, RN-supervised, across the interdisciplinary team",
    citation: "42 CFR 418.76",
  },
] as const;

const SUBJECT_ROWS = [
  ["Medication self-administration support", "0.75", "0.75"],
  ["Care for residents' assessed needs", "1.25", "2.00"],
  ["Dementia, cognitive & neurological support", "1.00", "1.50"],
  ["Infection control, hygiene & immobility risks", "1.75", "2.25"],
  ["Personal-care / ALF services", "1.25", "2.50"],
  ["Safe management techniques & de-escalation", "1.25", "1.50"],
  ["Fire safety", "0.75", "0.75"],
  ["Emergency preparedness", "1.25", "1.50"],
  ["Resident rights", "0.75", "0.75"],
  ["OAPSA abuse recognition & reporting", "0.50", "0.50"],
  ["Falls & accident prevention", "1.50", "2.00"],
] as const;

const CONDITIONAL_ROWS = [
  ["+ Mental illness / intellectual disability, if served", "+0.75", "+1.00"],
  ["+ Newly served population, when applicable", "+0.50", "+0.50–0.75"],
] as const;

const ADD_ONS = [
  {
    label: "§2800.69 — ALF dementia",
    body: (
      <>
        4 hours of dementia-specific training within 30 days of hire, then 2
        hours every year after. These hours do <strong>not</strong> count toward
        the 16-hour annual total.
      </>
    ),
  },
  {
    label: "§2600.236 — PCH secured dementia unit",
    body:
      "6 additional annual hours for staff assigned to a secured dementia care unit. Structured training — on-the-job hours don't qualify.",
  },
  {
    label: "§2800.236 — ALF special care units",
    body:
      "8 annual hours for staff on a dementia special care unit, and separately 8 hours for an INRBI special care unit. Unit assignment required.",
  },
  {
    label: "Administrators",
    body:
      "PCH and ALF administrators carry their own 24-hour annual continuing-education requirement, separate from staff in-service hours — plus the 100-hour qualification course (or NHA exemption).",
  },
] as const;

const CLINICAL_PATHS = [
  {
    title: "Nursing-home nurse aide",
    citation: "42 CFR 483.95 · 28 Pa. Code 201.20",
    body:
      "Tailored to each aide's most recent performance review and the facility assessment — not a generic annual class. Facility acceptance and documented attendance required.",
  },
  {
    title: "Home health aide",
    citation: "42 CFR 484.80 · 28 Pa. Code 601.35",
    body:
      "RN-supervised and documented by the employing agency, covering care-plan boundaries, observation and escalation, home safety, and required skill work.",
  },
  {
    title: "Hospice aide",
    citation: "42 CFR 418.76",
    body:
      "RN-supervised, adding hospice philosophy, the interdisciplinary group, grief and family support, active dying, and symptom escalation.",
  },
] as const;

const LIMITS = [
  "Unlicensed medication administration — requires the DHS-approved program and testing; insulin and epinephrine carry additional requirements.",
  "CPR / first aid, qualified fire-safety training, and facility-plan exercises — require certified trainers or facilitators with retained external evidence.",
  "Administrator continuing education — approved-provider rules apply; a completion certificate is not, by itself, accepted administrator CE.",
  "A certificate of course completion is never, by itself, a claim of Department, CMS, or professional-board approval.",
] as const;

const SOURCES = [
  {
    label: "55 Pa. Code §2600.65 — PCH annual staff training",
    href: "https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html",
  },
  {
    label: "55 Pa. Code §2600.236 — PCH secured dementia unit",
    href: "https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.236.html",
  },
  {
    label: "55 Pa. Code §2800.65 — ALF annual staff training",
    href: "https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html",
  },
  {
    label: "55 Pa. Code §2800.69 — additional ALF dementia training",
    href: "https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.69.html",
  },
  {
    label: "55 Pa. Code §6400.52 — Chapter 6400 annual training",
    href: "https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter6400/s6400.52.html",
  },
  {
    label: "42 CFR §483.95 — nursing facility training",
    href: "https://www.ecfr.gov/current/title-42/part-483/section-483.95",
  },
  {
    label: "42 CFR §484.80 — home health aide in-service",
    href: "https://www.ecfr.gov/current/title-42/part-484/section-484.80",
  },
  {
    label: "42 CFR §418.76 — hospice aide in-service",
    href: "https://www.ecfr.gov/current/title-42/part-418/section-418.76",
  },
] as const;

function ExternalSourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="inline-flex items-start gap-1.5 text-[13.5px] font-semibold leading-5 text-primary hover:text-[#0d2742] hover:underline"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      <span>{label}</span>
      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

export default function PaTrainingRequirements() {
  usePageMeta({
    ...MARKETING_ROUTE_META["/pa-training-requirements"],
    path: "/pa-training-requirements",
  });

  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="relative mx-auto flex max-w-[860px] flex-col items-center gap-4 px-4 py-16 text-center sm:px-6 lg:px-8">
          <Reveal>
            <span className="inline-flex rounded-full border border-white/20 bg-white/[0.08] px-3.5 py-1.5 text-xs font-bold text-[#b9e4ff]">
              Free resource · last reviewed July 2026
            </span>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight text-balance sm:text-[42px]">
              Pennsylvania annual training requirements, by facility type
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto max-w-[56ch] text-[17px] leading-7 text-white/85 text-pretty">
              What 55 Pa. Code and the federal aide rules actually require each
              year — the hour totals, the required subjects, and where the
              exceptions hide.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[980px] px-4 py-14 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              The short version
            </h2>
            <p className="mt-1.5 text-[14.5px] leading-6 text-[#44566b]">
              Annual in-service minimums per direct care worker or aide. Details,
              dementia add-ons, and role-by-role exceptions follow below.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="mt-5 overflow-x-auto rounded-[14px] border border-[#dfe6ee]">
              <table className="min-w-[640px] border-collapse text-left text-[13.5px]">
                <thead className="bg-[#fafbfc] font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#5d7084]">
                  <tr>
                    <th className="border-b border-[#eef2f6] px-[18px] py-3 font-semibold">
                      Setting
                    </th>
                    <th className="border-b border-[#eef2f6] px-2 py-3 font-semibold">
                      Annual requirement
                    </th>
                    <th className="border-b border-[#eef2f6] px-2 py-3 pr-[18px] font-semibold">
                      Citation
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SUMMARY_ROWS.map((row) => (
                    <tr key={row.setting} className="border-b border-[#eef2f6] last:border-b-0">
                      <th className="px-[18px] py-3 font-bold text-[#1c2b3a]">
                        {row.setting}
                      </th>
                      <td className="px-2 py-3 text-[#44566b]">{row.requirement}</td>
                      <td className="px-2 py-3 pr-[18px] font-mono text-xs text-[#5d7084]">
                        {row.citation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
          <Reveal delay={0.12}>
            <div className="mt-4 rounded-[10px] border border-[#f0d9a8] bg-[#fdf7ea] px-[18px] py-3.5 text-[13px] leading-6 text-[#6d5312]">
              This guide is informational, not legal advice. Requirements depend
              on license type, role, assignment, and population served — verify
              against the current regulations (linked below) and your DHS
              regional office.
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-[#f6f8fa]">
        <div className="mx-auto max-w-[980px] px-4 py-14 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              PCH &amp; ALF: how the annual hours break down by subject
            </h2>
            <p className="mt-1.5 max-w-[72ch] text-[14.5px] leading-6 text-[#44566b]">
              §2600.65(f)–(g) and §2800.65(i)–(j) name the required subjects but
              generally don&apos;t prescribe minutes per subject. The allocation below
              is CareBase&apos;s curriculum design covering every required topic — not
              a regulator-issued hour split.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="mt-5 overflow-hidden rounded-[14px] border border-[#dfe6ee] bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-[640px] border-collapse text-[13.5px]">
                  <thead className="bg-[#fafbfc] font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#5d7084]">
                    <tr>
                      <th className="border-b border-[#eef2f6] px-[18px] py-3 text-left font-semibold">
                        Required subject
                      </th>
                      <th className="border-b border-[#eef2f6] px-2 py-3 text-right font-semibold">
                        PCH hrs
                      </th>
                      <th className="border-b border-[#eef2f6] px-2 py-3 pr-[18px] text-right font-semibold">
                        ALF hrs
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {SUBJECT_ROWS.map(([subject, pch, alf]) => (
                      <tr key={subject} className="border-b border-[#eef2f6]">
                        <th className="px-[18px] py-2.5 text-left font-medium text-[#33465c]">
                          {subject}
                        </th>
                        <td className="px-2 py-2.5 text-right font-mono text-[#1c2b3a]">
                          {pch}
                        </td>
                        <td className="px-2 py-2.5 pr-[18px] text-right font-mono text-[#1c2b3a]">
                          {alf}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-[#eef2f6] bg-[#eaf3fc] font-bold text-[#0d2742]">
                      <th className="px-[18px] py-3 text-left">Annual total</th>
                      <td className="px-2 py-3 text-right font-mono">12.00</td>
                      <td className="px-2 py-3 pr-[18px] text-right font-mono">16.00</td>
                    </tr>
                    {CONDITIONAL_ROWS.map(([subject, pch, alf], index) => (
                      <tr key={subject} className={index === 0 ? "border-b border-[#eef2f6]" : undefined}>
                        <th className="px-[18px] py-2.5 text-left font-medium text-[#5d7084]">
                          {subject}
                        </th>
                        <td className="px-2 py-2.5 text-right font-mono text-[#5d7084]">
                          {pch}
                        </td>
                        <td className="px-2 py-2.5 pr-[18px] text-right font-mono text-[#5d7084]">
                          {alf}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-[#eef2f6] bg-[#fafbfc] px-[18px] py-3 text-xs leading-5 text-[#5d7084]">
                Conditional topics add hours only when they apply — an N/A topic
                never produces fabricated credit. Up to 6 of the PCH hours may
                be supervised on-the-job training.
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto flex max-w-[980px] flex-col gap-10 px-4 py-14 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              Dementia &amp; specialty-unit add-ons
            </h2>
            <p className="mt-1.5 text-[14.5px] leading-6 text-[#44566b]">
              These are separate requirements on top of the annual totals above.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {ADD_ONS.map((item) => (
                <article key={item.label} className="rounded-xl border border-[#dfe6ee] p-[18px]">
                  <h3 className="font-mono text-[11px] font-semibold uppercase text-primary">
                    {item.label}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-6 text-[#44566b]">
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          </Reveal>

          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              Chapter 6400 community homes
            </h2>
            <p className="mt-1.5 max-w-[72ch] text-[14.5px] leading-6 text-[#44566b]">
              §6400.52 requires <strong>24 annual hours</strong> for direct service
              workers, their direct supervisors, and program specialists — and
              separately <strong>12 hours</strong> for specified other roles. The
              24-hour core covers: person-centered practice and community
              relationships (4 hrs) · abuse prevention and protective-services
              reporting (4) · rights foundations and rights in daily practice
              (4) · incident response, documentation and prevention (4) ·
              health/safety, records/funds, medication awareness, and emergency
              readiness (4) · current person-specific behavior support (2) ·
              current assessment and Individual Plan implementation (2).
            </p>
            <div className="mt-4 rounded-[10px] border border-[#dfe6ee] bg-[#fafbfc] px-[18px] py-3.5 text-[13px] leading-6 text-[#44566b]">
              §6400.46 separately requires 1 hour of qualified fire-safety
              training and a 3-hour first-aid / Heimlich / CPR skills course
              from an eligible certified trainer, delivered in person.
              Person-specific behavior-support and plan work must be facilitated
              — not web-only.
            </div>
          </Reveal>

          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              Clinical aide paths — 12 hours each
            </h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {CLINICAL_PATHS.map((path) => (
                <article key={path.title} className="rounded-xl border border-[#dfe6ee] p-[18px]">
                  <h3 className="text-[14.5px] font-bold text-[#0d2742]">
                    {path.title}
                  </h3>
                  <p className="mt-0.5 font-mono text-[11px] text-[#5d7084]">
                    {path.citation}
                  </p>
                  <p className="mt-2 text-[13px] leading-6 text-[#44566b]">
                    {path.body}
                  </p>
                </article>
              ))}
            </div>
          </Reveal>

          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              What no course can self-certify
            </h2>
            <div className="mt-3 flex flex-col gap-2 text-sm leading-6 text-[#44566b]">
              {LIMITS.map((limit) => (
                <div key={limit} className="flex gap-2.5">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#a83a2c]" />
                  <span>{limit}</span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              Primary sources
            </h2>
            <div className="mt-2.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {SOURCES.map((source) => (
                <ExternalSourceLink key={source.href} {...source} />
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#cfe2f4] bg-[#eaf3fc]">
        <div className="mx-auto flex max-w-[720px] flex-col items-center gap-3 px-4 py-10 text-center sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[22px] font-bold text-[#0d2742]">
              Keep this guide
            </h2>
            <p className="mx-auto mt-2 max-w-[52ch] text-sm leading-6 text-[#44566b]">
              Save it for your binder — plus check back when the regulations
              change. Nothing else, no drip sequence.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <Button
              type="button"
              className="gap-2"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" />
              Print or save PDF
            </Button>
          </Reveal>
        </div>
      </section>

      <section className="bg-[#071626] text-white">
        <div className="mx-auto flex max-w-[860px] flex-col items-center gap-3.5 px-4 py-14 text-center sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[28px] font-bold tracking-tight">
              CareBase applies all of this automatically
            </h2>
            <p className="mx-auto mt-3 max-w-[52ch] text-[15px] leading-7 text-white/82">
              Facility type and role map each employee to the right hour buckets,
              subjects, and renewal windows — configured once, tracked
              continuously.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="mt-1.5 flex flex-wrap justify-center gap-3">
              <Button asChild className="gap-2 bg-white font-bold text-[#0d2742] hover:bg-[#dcebfa]">
                <Link href="/signup">
                  Start a free trial
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                <Link href="/faq">Questions? Read the FAQ</Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingLayout>
  );
}
