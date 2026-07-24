import { ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { VideoThumbnail } from "@/components/marketing/VideoModal";
import { MARKETING_VIDEOS } from "@/components/marketing/marketingVideos";
import { usePageMeta } from "@/lib/usePageMeta";

const STORY = [
  "Most personal care homes don't fail surveys because staff never learned the material. They struggle because the proof lives in paper sign-in sheets, old PDFs, email attachments, and a spreadsheet only one person understands. When the surveyor arrives, the work was done — but the documentation can't be found.",
  "CareBase is our answer: one operating record where training, credentials, resident assessments, incidents, drills, maintenance, and scheduling all attach their own proof as the work happens. Your binder becomes something you export, not a project you dread.",
  "We build it against the actual regulations — 55 Pa. Code Chapters 2600 and 2800 first — and we prove it in real Pennsylvania facilities every day. CareBase is part of the CareMetric family of care-operations products.",
] as const;

const PRINCIPLES = [
  {
    label: "01 — HONEST BOUNDARIES",
    text: "We name what CareBase doesn't replace — your eMAR, EHR, payroll, and accounting stay authoritative. No compliance guarantee, no universal ROI number.",
  },
  {
    label: "02 — A HUMAN CHECKS THE AI",
    text: "AI drafts training content based on your own documents and points out gaps instead of inventing citations — and nothing goes live without a named reviewer's sign-off.",
  },
  {
    label: "03 — SECURITY AT THE DATABASE",
    text: "Role and facility scope are enforced by database policy, documentation lives in private storage behind short-lived links, and compliance actions are immutably logged.",
  },
] as const;

const FOUNDER_BIO = [
  "I've spent more than twenty years in senior care — five years in nursing home management, and the last seventeen in hospice — with a master's degree in social work and a doctorate in naturopathic medicine.",
  "Consulting across nursing homes and personal care homes, I built my reputation on two things: strict compliance and real patient care. And I kept seeing the same gap — personal care homes carry the same responsibilities as nursing homes, but never had the same tools.",
  "CareBase is the software I designed to close that gap. It handles compliance paperwork, resident care, billing and financial management, staff education, and your state documentation — so when the state surveyor walks in, you're already ready. It's the software you always hoped for, and could never find.",
] as const;

const FOUNDER_CREDENTIALS = [
  "MSW",
  "Doctorate, Naturopathic Medicine",
  "Certified Medication Administration Trainer (~10 yrs)",
  "Certified Hospice & Palliative Care Administrator",
  "Certified Diabetic Educator",
  "Nationally Certified Guardian",
] as const;

const PARTNER_NOTES = [
  {
    lead: "You get:",
    text: "guided setup against your roster, a direct line to the builders, your workflow prioritized on the roadmap, and founding-partner pricing locked for as long as you subscribe.",
  },
  {
    lead: "We ask:",
    text: "run at least one real workflow in CareBase, a short feedback call every few weeks, and permission to quote results — never resident or staff data.",
  },
  {
    lead: "Good fit:",
    text: "a PA personal care home or assisted living facility, single or multi-site, currently running compliance on spreadsheets, binders, or a training-only LMS.",
  },
] as const;

export default function About() {
  usePageMeta({ ...MARKETING_ROUTE_META["/about"], path: "/about" });

  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="relative mx-auto flex max-w-[860px] flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
          <span className="inline-flex rounded-full border border-white/20 bg-white/[0.08] px-3.5 py-1.5 text-xs font-bold text-[#b9e4ff]">
            About CareMetric CareBase
          </span>
          <h1 className="text-balance text-[42px] font-bold leading-[1.1] tracking-[-0.015em]">
            Built in Pennsylvania, with the operators who run these buildings
          </h1>
          <p className="max-w-[54ch] text-pretty text-[17px] leading-7 text-white/85">
            CareBase exists because survey prep shouldn't be a night of printing and hole-punching — and because compliance software shouldn't overpromise.
          </p>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <Reveal className="mx-auto flex max-w-[760px] flex-col gap-[18px] px-4 py-16 sm:px-6">
          <h2 className="text-[28px] font-bold leading-tight text-[#0d2742]">Why we're building this</h2>
          {STORY.map((paragraph) => (
            <p key={paragraph} className="text-pretty text-[15.5px] leading-7 text-[#33465c]">
              {paragraph}
            </p>
          ))}
        </Reveal>
      </section>

      <section className="border-b border-[#e5eaf0] bg-[#f6f8fa]">
        <div className="mx-auto max-w-[1160px] px-4 py-16 sm:px-6">
          <Reveal>
            <h2 className="text-center text-[28px] font-bold leading-tight text-[#0d2742]">
              Three principles we won't trade away
            </h2>
          </Reveal>
          <div className="mt-6 grid gap-3.5 md:grid-cols-3">
            {PRINCIPLES.map((principle, index) => (
              <Reveal key={principle.label} delay={index * 0.06}>
                <article className="h-full rounded-xl border border-[#dfe6ee] bg-white p-[22px]">
                  <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#1b6fc2]">{principle.label}</div>
                  <p className="mt-2.5 text-sm leading-6 text-[#44566b]">{principle.text}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[860px] px-4 py-16 sm:px-6">
          <Reveal>
            <h2 className="text-[28px] font-bold leading-tight text-[#0d2742]">Meet the founder</h2>
            <p className="mt-1.5 text-[14.5px] leading-6 text-[#44566b]">
              In senior care, people buy from people they can call. Here's who answers.
            </p>
          </Reveal>
          <div className="mt-7 grid gap-8 md:grid-cols-[minmax(0,300px)_1fr] md:items-start">
            <Reveal>
              <VideoThumbnail
                video={MARKETING_VIDEOS.founder}
                label="A message from Kevin"
                sublabel="Founder · CareMetric CareBase"
              />
            </Reveal>
            <Reveal delay={0.08} className="flex flex-col gap-4">
              <div>
                <div className="text-[20px] font-bold leading-tight text-[#0d2742]">Kevin Deyarmin</div>
                <div className="mt-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-[#1b6fc2]">
                  Founder — CareMetric CareBase
                </div>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {FOUNDER_CREDENTIALS.map((credential) => (
                  <li
                    key={credential}
                    className="rounded-full bg-[#eef4fb] px-2.5 py-1 text-[11.5px] font-semibold text-[#1b4a78]"
                  >
                    {credential}
                  </li>
                ))}
              </ul>
              {FOUNDER_BIO.map((paragraph) => (
                <p key={paragraph} className="text-pretty text-[15px] leading-7 text-[#33465c]">
                  {paragraph}
                </p>
              ))}
            </Reveal>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#071626] text-white">
        <TechGrid />
        <div className="relative mx-auto grid max-w-[1160px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-start">
          <Reveal className="flex flex-col gap-3">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#8ec8ff]">Founding partners</span>
            <h2 className="text-balance text-[30px] font-bold leading-tight tracking-[-0.01em]">
              Founding-partner pricing for early Pennsylvania operators
            </h2>
            <p className="text-[15px] leading-7 text-white/85">
              A limited group of early PCH and ALF operators get founding-partner terms: direct access to the team, priority on their highest-risk workflow, and locked-in pricing for life. We ask for real usage and honest feedback.
            </p>
            <Button asChild variant="secondary" className="mt-1.5 self-start bg-white px-5 py-3 text-[14.5px] font-bold text-[#0d2742] hover:bg-[#dcebfa]">
              <Link href="/signup">Start your trial — partner terms apply automatically</Link>
            </Button>
          </Reveal>
          <Reveal delay={0.1} className="flex flex-col gap-2.5">
            {PARTNER_NOTES.map((note) => (
              <div key={note.lead} className="rounded-xl border border-white/15 bg-white/[0.06] px-[18px] py-4 text-[13.5px] leading-6 text-white/85">
                <strong className="text-[#b9e4ff]">{note.lead}</strong> {note.text}
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-[860px] gap-10 px-4 py-16 sm:px-6 md:grid-cols-2">
          <Reveal className="flex flex-col gap-2.5">
            <h2 className="text-[22px] font-bold leading-tight text-[#0d2742]">The CareMetric family</h2>
            <p className="text-sm leading-6 text-[#44566b]">CareBase is one of several CareMetric products for care operations.</p>
            <div className="flex flex-col gap-1.5 text-sm">
              <a href="https://caremetric.ai" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#1b6fc2] hover:text-[#0d2742] hover:underline">
                CareMetric AI <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <a href="https://cmbreathe.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#1b6fc2] hover:text-[#0d2742] hover:underline">
                CareMetric Breathe <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </Reveal>
          <Reveal delay={0.08} className="flex flex-col gap-2.5">
            <h2 className="text-[22px] font-bold leading-tight text-[#0d2742]">Talk to us</h2>
            <p className="text-sm leading-6 text-[#44566b]">One inbox, answered by the people building the product.</p>
            <a href="mailto:hello@caremetric.ai" className="text-[15px] font-bold text-[#1b6fc2] hover:text-[#0d2742] hover:underline">
              hello@caremetric.ai
            </a>
            <Link href="/signup" className="text-sm text-[#1b6fc2] hover:text-[#0d2742] hover:underline">
              or start your trial and map your workflows →
            </Link>
          </Reveal>
        </div>
      </section>
    </MarketingLayout>
  );
}
