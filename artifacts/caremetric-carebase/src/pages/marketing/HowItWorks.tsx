import { CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

const WORKFLOW_STEPS = [
  {
    title: "Configure the operation",
    description:
      "Add facilities, roles, residents, and employees. Import your roster by CSV. Set the training, credential, and alert rules that apply.",
    example:
      "A PCH direct care worker automatically gets the 12-hour §2600.65 bucket.",
  },
  {
    title: "Route the work",
    description:
      "Training, resident services, schedules, incident follow-up, and approvals go to the person responsible — each with an owner and a deadline.",
    example:
      "A hospital return opens notification, reassessment, and plan-review tasks.",
  },
  {
    title: "Capture proof as it happens",
    description:
      "Completions, signatures, uploads, sign-ins, and audit events attach to the right employee, resident, requirement, and date.",
    example: "A QR class check-in becomes logged in-service hours instantly.",
  },
  {
    title: "See risk, share documentation",
    description:
      "Dashboards and escalating alerts surface gaps early. Binders and documentation rooms answer leadership, auditors, and surveyors.",
    example: "The binder PDF rebuilds from live records in one click.",
  },
] as const;

const SWITCHING_POINTS = [
  {
    lead: "An afternoon, not a project.",
    text: "CSV import brings your whole roster in; your binder stays untouched while you ramp.",
  },
  {
    lead: "Staff need only a browser.",
    text: "QR check-in from their own phones, a phone-installable training player — no app store, no IT.",
  },
  {
    lead: "Run both for month one.",
    text: "Keep the paper binder alongside until CareBase has earned your trust.",
  },
  {
    lead: "Your data leaves with you.",
    text: "Export everything if you cancel — your records are yours to keep.",
  },
] as const;

const WEEK_EVENTS = [
  {
    day: "Monday",
    text: "A new aide is hired. Her 12-hour §2600.65 plan, orientation checklist, Act 34 countdown, and TB screen are assigned before lunch — nobody built a spreadsheet row.",
  },
  {
    day: "Tuesday",
    text: "Mr. Alvarez returns from the hospital. Provider notification, reassessment, and support-plan review open automatically, each with an owner and a clock.",
  },
  {
    day: "Wednesday",
    text: "Dementia in-service, 2 p.m. Staff scan the rotating QR at the door; the hours land on each record the moment they sign in. No paper sheet to file.",
  },
  {
    day: "Thursday",
    text: "Second-shift fire drill, east wing. Logged from a phone during the drill — evacuation time, every §2600.132 field, PDF filed before the shift ends.",
  },
  {
    day: "Friday",
    text: "Corporate asks how the facility looks. You export the binder PDF from live records and go home on time. That's the product.",
  },
] as const;

const SPECIFIC_PROMISES = [
  {
    title: "We don't replace your eMAR, EHR, or payroll.",
    text: "CareBase runs the coordination layer around them — and routes medication events from your external source instead of pretending to administer them.",
  },
  {
    title: "We don't guarantee a deficiency-free survey.",
    text: "We make requirements, deadlines, ownership, and documentation visible so your team closes gaps before the surveyor finds them.",
  },
  {
    title: "We don't quote a universal ROI.",
    text: "You model savings with your own hours, labor cost, and tool spend — risk avoidance deliberately excluded.",
  },
] as const;

const TRUST_NOTES = [
  {
    lead: "Built from a real binder.",
    text: "The 60+ forms are adapted from an actual PA survey-readiness binder, not made up.",
  },
  {
    lead: "Ranked by real citations.",
    text: "Readiness scoring is ranked by what DHS actually cites, not a generic checklist.",
  },
] as const;

function SectionIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <Reveal className="mx-auto flex max-w-[620px] flex-col gap-2.5 text-center">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#1b6fc2]">
        {eyebrow}
      </p>
      <h2 className="m-0 text-balance text-[32px] font-bold leading-tight tracking-[-0.01em] text-[#0d2742] max-sm:text-3xl">
        {title}
      </h2>
      {description && <p className="m-0 text-[15px] text-[#44566b]">{description}</p>}
    </Reveal>
  );
}

export default function HowItWorks() {
  usePageMeta({
    ...MARKETING_ROUTE_META["/how-it-works"],
    path: "/how-it-works",
  });

  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <Reveal className="relative mx-auto flex max-w-[860px] flex-col items-center gap-[15px] px-6 py-[60px] text-center">
          <span className="inline-flex rounded-full border border-white/20 bg-white/[0.08] px-3.5 py-1.5 text-xs font-bold text-[#b9e4ff]">
            How it works
          </span>
          <h1 className="m-0 text-balance text-[42px] font-bold leading-[1.1] tracking-[-0.015em] max-sm:text-4xl">
            From spreadsheet chaos to survey-ready
          </h1>
          <p className="m-0 max-w-[56ch] text-pretty text-[16.5px] text-white/85">
            The four moves every module follows, what switching actually takes,
            and what a normal week looks like once CareBase is running your
            facility.
          </p>
        </Reveal>
      </section>

      <section
        id="how"
        className="scroll-mt-24 border-b border-[#e5eaf0] bg-white"
      >
        <div className="mx-auto max-w-[1160px] px-6 py-[72px]">
          <SectionIntro
            eyebrow="How it works"
            title="Set it up once. It nags so you don't have to."
            description="Every module — training, residents, incidents, maintenance — follows the same four moves, so staff learn it once."
          />

          <div className="mt-9 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_STEPS.map((step, index) => (
              <Reveal key={step.title} delay={index * 0.05}>
                <article className="flex h-full flex-col gap-2.5 rounded-xl border border-[#e5eaf0] p-[22px]">
                  <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#0d2742] font-mono text-sm font-bold text-white">
                    {index + 1}
                  </span>
                  <h3 className="text-[15.5px] font-bold text-[#0d2742]">
                    {step.title}
                  </h3>
                  <p className="m-0 text-[13.5px] text-[#44566b]">
                    {step.description}
                  </p>
                  <p className="mt-auto border-t border-[#eef2f6] pt-2.5 text-xs text-[#5d7084]">
                    {step.example}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>

          <p className="mx-auto mt-5 text-center text-[13px] text-[#5d7084]">
            Setup is self-serve — most single facilities are entering real
            records the same day.
          </p>

          <Reveal className="mt-10 rounded-[14px] border border-[#dfe6ee] bg-[#f6f8fa] p-[26px]">
            <h3 className="mb-4 text-center text-xl font-bold text-[#0d2742]">
              Switching without the drama
            </h3>
            <div className="grid gap-3.5 md:grid-cols-2">
              {SWITCHING_POINTS.map((point) => (
                <div
                  key={point.lead}
                  className="flex gap-2.5 text-[13.5px] text-[#33465c]"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1e7a35]" />
                  <span>
                    <strong>{point.lead}</strong> {point.text}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[1160px] px-6 py-16">
          <SectionIntro
            eyebrow="A week with CareBase"
            title="What actually changes, day by day"
          />
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {WEEK_EVENTS.map((event, index) => (
              <Reveal key={event.day} delay={index * 0.04}>
                <article className="flex h-full flex-col gap-2 rounded-xl border border-[#dfe6ee] p-[18px]">
                  <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[#1b6fc2]">
                    {event.day}
                  </h3>
                  <p className="m-0 text-[13.5px] text-[#33465c]">
                    {event.text}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section
        id="promises"
        className="scroll-mt-24 bg-[#071626] text-white"
      >
        <div className="relative overflow-hidden">
          <TechGrid />
          <div className="relative mx-auto max-w-[1160px] px-6 py-[72px]">
            <Reveal className="flex max-w-[620px] flex-col gap-3">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#8ec8ff]">
                Why operators trust us
              </p>
              <h2 className="m-0 text-balance text-[30px] font-extrabold leading-tight tracking-[-0.02em]">
                Our promises are unusually specific
              </h2>
              <p className="m-0 text-[15px] text-white/82">
                Compliance software is full of guarantees nobody can keep. We'd
                rather tell you the boundaries.
              </p>
            </Reveal>

            <div className="mt-7 grid gap-3.5 lg:grid-cols-3">
              {SPECIFIC_PROMISES.map((promise, index) => (
                <Reveal key={promise.title} delay={index * 0.05}>
                  <article className="h-full rounded-xl border border-white/15 bg-white/[0.06] p-5">
                    <h3 className="text-[15px] font-extrabold text-[#b9e4ff]">
                      {promise.title}
                    </h3>
                    <p className="mt-2 text-[13.5px] leading-[1.55] text-white/80">
                      {promise.text}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>

            <div className="mt-5 grid items-stretch gap-3.5 lg:grid-cols-2">
              <Reveal className="flex flex-col gap-2.5">
                <div className="grid gap-2 text-[12.5px] sm:grid-cols-3">
                  {TRUST_NOTES.map((note) => (
                    <div
                      key={note.lead}
                      className="rounded-[10px] border border-white/15 bg-white/[0.06] px-3.5 py-3 text-white/85"
                    >
                      <strong className="text-[#b9e4ff]">{note.lead}</strong>{" "}
                      {note.text}
                    </div>
                  ))}
                  <div className="rounded-[10px] border border-white/15 bg-white/[0.06] px-3.5 py-3 text-white/85">
                    <strong className="text-[#b9e4ff]">People you can call.</strong>{" "}
                    <Link className="text-[#b9e4ff] hover:underline" href="/about">
                      Meet the team
                    </Link>{" "}
                    — one inbox, answered by the builders.
                  </div>
                </div>
              </Reveal>

              <Reveal delay={0.08} className="flex h-full flex-col justify-center gap-2.5 rounded-xl border border-white/15 bg-white/[0.06] p-5">
                <h3 className="text-[15px] font-extrabold">
                  Founding-partner pricing for early operators
                </h3>
                <p className="text-[13px] text-white/80">
                  Early PCH and ALF operators get a direct line to the builders
                  — the product shapes itself around your real workflows. Email
                  hello@caremetric.ai to be enrolled; we honor founding-partner
                  pricing for the life of your subscription.
                </p>
                <Button
                  asChild
                  variant="secondary"
                  className="self-start rounded-lg bg-white px-4 py-2 text-[13.5px] font-bold text-[#0d2742] hover:bg-[#dcebfa]"
                >
                  <a href="mailto:hello@caremetric.ai?subject=Founding%20partner%20enrollment">
                    Email us to become a founding partner
                  </a>
                </Button>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#071626] text-white">
        <Reveal className="mx-auto flex max-w-[860px] flex-col items-center gap-3.5 px-6 py-14 text-center">
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.01em]">
            See it run your own workflows
          </h2>
          <p className="m-0 max-w-[52ch] text-[15px] text-white/82">
            Self-serve CareBase trial with every module included — signup to
            first binder without a single phone call.
          </p>
          <div className="mt-1.5 flex flex-wrap justify-center gap-3">
            <Button
              asChild
              variant="secondary"
              className="rounded-[9px] bg-white px-5 py-3 text-[14.5px] font-bold text-[#0d2742] hover:bg-[#dcebfa]"
            >
              <Link href="/signup">Start a free trial</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="rounded-[9px] border-white/30 bg-transparent px-5 py-3 text-[14.5px] font-bold text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/faq">Questions? Read the FAQ</Link>
            </Button>
          </div>
        </Reveal>
      </section>
    </MarketingLayout>
  );
}
