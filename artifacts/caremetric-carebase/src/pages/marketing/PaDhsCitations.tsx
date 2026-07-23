import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  BedDouble,
  ClipboardCheck,
  ClipboardList,
  Droplets,
  ExternalLink,
  FileCheck,
  FileText,
  Flame,
  GraduationCap,
  HeartPulse,
  Info,
  Lock,
  Pill,
  Printer,
  Scale,
  ShieldCheck,
  Stethoscope,
  UtensilsCrossed,
} from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/lib/usePageMeta";

/**
 * Educational resource: the regulations that generate the most 55 Pa. Code
 * Chapter 2600 (personal care home) and Chapter 2800 (assisted living)
 * citations, and why DHS surveyors write them.
 *
 * Ranking and percentages come from the DHS Bureau of Human Services Licensing
 * (BHSL) 2025 Annual Report -- the "Ten Most Frequently Cited Violations"
 * tables for PCH and ALR, published June 2026 (the most recent citation data
 * available). "Percent of inspections cited" is the share of licensing
 * inspections in which that section was cited at least once. Entries are
 * ordered by the higher of the PCH or ALF 2025 rate. The final three are the
 * medication-cluster and incident-reporting sections that closely follow the
 * published top ten and recur across the 2024 and 2022 reports -- included so
 * the fifteen cover the full picture surveyors actually write up. This page is
 * informational, not legal advice. "ALF" is this org's term for the Chapter
 * 2800 facility type (the regulation itself says "assisted living residence").
 */

type Rate = string | null;

type Citation = {
  rank: number;
  icon: LucideIcon;
  sections: string;
  title: string;
  pch: Rate;
  alf: Rate;
  /** Shown instead of a percentage when the section is not in the 2025 top ten. */
  note?: string;
  requires: string;
  why: string;
  avoid: string;
  /** How CareMetric CareBase closes this specific gap. */
  carebase: string;
};

const TOP_15: Citation[] = [
  {
    rank: 1,
    icon: FileText,
    sections: "§2600.187 · §2800.187",
    title: "Medication records",
    pch: "7.57%",
    alf: "6.12%",
    requires:
      "A complete, accurate medication administration record (MAR) for every resident: the drug, dose, route, time, the prescriber's order behind it, and a staff initial for every dose given, refused, or held.",
    why:
      "The single most-cited regulation in Pennsylvania. Surveyors find blank boxes on the MAR (a dose with no initial can't be proven given), doses initialed at the wrong time, PRN medications with no reason or effect documented, discontinued drugs still listed, or a MAR that doesn't match the current physician order. The care may have happened -- but if it isn't documented correctly, the regulation treats it as not done.",
    avoid:
      "Reconcile the MAR against current orders every cycle, require real-time initialing (not end-of-shift catch-up), and audit a sample of MARs weekly for blanks before the surveyor does.",
    carebase:
      "CareBase's medication-event integration surfaces missing and exception medication records, and the compliance reporting center flags MAR gaps before a surveyor ever opens the binder — while credential tracking confirms only currently-certified staff are administering.",
  },
  {
    rank: 2,
    icon: GraduationCap,
    sections: "§2600.65 · §2800.65",
    title: "Direct care staff training & orientation",
    pch: "5.40%",
    alf: "6.88%",
    requires:
      "Orientation before a staff person works with residents, plus annual training -- 12 hours per direct care worker in a PCH, 16 hours in an ALF -- covering the regulation's required subjects, with dementia hours on top where they apply.",
    why:
      "Cited when a personnel file can't prove the hours: annual training completed late or short of the minimum, orientation missing or undated, no record of the topics covered, or dementia-specific hours absent for staff on a secured or special-care unit. Surveyors count documented hours -- an untracked in-service didn't happen.",
    avoid:
      "Track hours per employee against their hire-date anniversary, tie completion to signed rosters that name the subject and duration, and flag anyone approaching their window before it closes.",
    carebase:
      "Role-based training plans assign the exact required hours by role and setting, track every employee against their own hire-date anniversary, and warn managers before a window closes — the compliance reporting center shows the whole roster's status at a glance.",
  },
  {
    rank: 3,
    icon: Flame,
    sections: "§2600.132 · §2800.132",
    title: "Fire drills",
    pch: "4.35%",
    alf: "6.02%",
    requires:
      "A fire drill every month, held at different times and on different shifts across the year -- including sleeping hours -- with a written record of the date, time, evacuation time, staff present, and any problems corrected.",
    why:
      "One of the easiest citations to earn on paper. Drills bunched on the day shift, months with no drill, evacuation times over the standard with no corrective note, or drill logs missing the required fields. An unannounced overnight drill is frequently the one facilities skip -- and the one surveyors look for.",
    avoid:
      "Schedule drills across every shift and month in advance, rotate the simulated exit, and record evacuation time plus a corrective note every single time -- even when the drill goes well.",
    carebase:
      "The fire-drill & life-safety log captures date, time, shift, and evacuation time for every drill and flags a missed month or a shift you haven't drilled — so the bunched-up, day-shift-only pattern surveyors look for never forms.",
  },
  {
    rank: 4,
    icon: Lock,
    sections: "§2600.183 · §2800.183",
    title: "Storage & disposal of medications & medical supplies",
    pch: "5.34%",
    alf: "5.64%",
    requires:
      "Medications stored safely and under lock, controlled substances under a second lock, correct temperature for refrigerated drugs, separation by resident, and proper documented destruction of expired, discontinued, or discharged-resident medications.",
    why:
      "Surveyors open the med cart and the fridge. Common findings: an unlocked cart or med room, expired medications still in stock, a discharged resident's drugs never destroyed, controlled substances not double-locked, or a refrigerator with no temperature log. Destruction with no witnessed, dated record is cited even when the drugs are gone.",
    avoid:
      "Log refrigerator temperatures daily, pull expired and discontinued stock on a set schedule, keep a second lock on controlled substances, and document every destruction with a witness and date.",
    carebase:
      "CareBase turns temperature checks, expiration pulls, and witnessed destruction into tracked recurring tasks, then files the dated destruction evidence straight into the one-click compliance binder.",
  },
  {
    rank: 5,
    icon: Scale,
    sections: "§2600.42 · §2800.42",
    title: "Specific rights (resident rights)",
    pch: "3.92%",
    alf: "4.68%",
    requires:
      "Residents are informed of their rights and those rights are honored in practice -- dignity and respect, privacy, unrestricted mail, phone and visitors, control of personal funds, and freedom from retaliation or unnecessary restriction.",
    why:
      "Cited when the daily reality doesn't match the rights on paper: mail or visits controlled without cause, a resident's funds handled without records or receipts, personal belongings restricted, privacy not maintained during care, or no signed acknowledgment that the resident was informed of their rights at admission.",
    avoid:
      "Get a dated rights acknowledgment at admission, keep clean personal-funds ledgers with receipts, and train staff that dignity, privacy, and access are operational rules, not slogans.",
    carebase:
      "Policy-attestation campaigns capture the signed rights acknowledgment at admission with ESIGN/UETA evidence, and resident financial operations keep an auditable personal-funds ledger — the two rights failures cited most.",
  },
  {
    rank: 6,
    icon: UtensilsCrossed,
    sections: "§2600.103 · §2800.103",
    title: "Food service",
    pch: "4.60%",
    alf: "4.40%",
    requires:
      "Nutritionally adequate meals following planned menus, therapeutic and modified diets as ordered, comparable substitutions when the menu changes, and no more than roughly 14 hours between the evening meal and breakfast.",
    why:
      "Findings cluster around the gap between the menu and the plate: a posted menu the kitchen didn't follow with no substitution recorded, a physician-ordered therapeutic diet not actually served, meals short of nutritional requirements, or an overnight fast longer than allowed. Food storage, labeling, and dating problems land here too.",
    avoid:
      "Post the menu you actually serve, record every substitution and its nutritional equivalence, keep ordered diets visible to kitchen staff, and date-label stored food.",
    carebase:
      "Dietary & food-safety operations tie each resident's ordered therapeutic diet to the menu, log every substitution, and track meal timing — so the plate always matches the order and the fast between meals stays inside the limit.",
  },
  {
    rank: 7,
    icon: ClipboardList,
    sections: "§2600.185 · §2800.185",
    title: "Accountability of medication & controlled substances",
    pch: "4.23%",
    alf: "3.44%",
    requires:
      "A running count of controlled substances that reconciles shift to shift, prompt investigation of any discrepancy, and a documented, witnessed trail for every controlled dose received, given, and destroyed.",
    why:
      "The count doesn't add up, or there's no count at all. Surveyors ask to reconcile a Schedule II drug and find gaps, missing shift counts, a discrepancy never investigated, or destruction that no one witnessed. This is the accountability half of the medication rules -- separate from the storage citation, and often cited alongside it.",
    avoid:
      "Count controlled substances at every shift change with two signatures, reconcile against the MAR, and investigate and document any variance the same day.",
    carebase:
      "Medication-event integration keeps the controlled-substance trail intact and surfaces any unreconciled variance in the compliance reporting center — before a missing count becomes a citation.",
  },
  {
    rank: 8,
    icon: Droplets,
    sections: "§2600.85 · §2800.85",
    title: "Sanitation",
    pch: "3.71%",
    alf: "3.54%",
    requires:
      "Clean, sanitary, pest-free conditions throughout the home, safe handling of waste, and hot water delivered within the required temperature range at resident fixtures.",
    why:
      "A walk-through citation: evidence of insects or rodents, soiled bathrooms or common areas, kitchens out of sanitary condition, garbage not handled properly, or water at fixtures too hot (a scald risk) or too cold. These are visible on inspection day and hard to explain away after the fact.",
    avoid:
      "Run a documented cleaning schedule, keep a pest-control contract with service records, and check and log water temperatures at resident fixtures.",
    carebase:
      "This one's a walk-through finding CareBase can't scrub for you — but its maintenance module turns cleaning, pest control, and water-temperature checks into tracked recurring tasks with a dated record, so the routine is provable at survey.",
  },
  {
    rank: 9,
    icon: ClipboardCheck,
    sections: "§2600.225 · §2800.225",
    title: "Initial & annual assessment",
    pch: "3.67%",
    alf: null,
    note: "PCH top ten",
    requires:
      "A resident assessment on the required tool at admission, again annually, and whenever the resident's condition changes -- fully completed, signed, and dated, covering every required domain.",
    why:
      "Cited when the assessment is late, missing a domain, unsigned or undated, or never updated after a fall, hospitalization, or clear change in condition. Because the support plan is built from the assessment, a weak assessment usually drags a support-plan citation along with it.",
    avoid:
      "Calendar every resident's annual assessment from their admission date, trigger a reassessment on any change of condition, and confirm each one is complete and signed before it's filed.",
    carebase:
      "Digital RASP/ASP assessment prep schedules each annual from the admission date and auto-triggers a reassessment on any change of condition — and because the support plan is built from it, closing the assessment gap closes the support-plan citation that usually rides along.",
  },
  {
    rank: 10,
    icon: Stethoscope,
    sections: "§2600.141 · §2800.141",
    title: "Resident medical evaluation & health care",
    pch: "3.54%",
    alf: "≈3.5%",
    note: "ALF: 2024 rate",
    requires:
      "An initial medical evaluation within the required window around admission, an annual medical evaluation after that, tuberculosis screening, and documented arrangement of the health care a resident needs.",
    why:
      "The admission or annual physical is missing, incomplete, or done outside the allowed window; the TB screening isn't documented; or the examiner never signed the form. Surveyors also cite failure to arrange follow-up care a resident clearly needed.",
    avoid:
      "Make the initial medical evaluation and TB screening a hard gate on admission, track annual evaluations like any other renewal, and confirm the examiner signed before filing.",
    carebase:
      "CareBase gates the initial medical evaluation and TB screening at admission and tracks the annual like any other renewal — flagging a missing, expired, or unsigned exam long before the surveyor asks for it.",
  },
  {
    rank: 11,
    icon: FileCheck,
    sections: "§2600.227 · §2800.227",
    title: "Development of the support plan",
    pch: "≈4.1%",
    alf: "3.25%",
    note: "PCH: 2024 rate",
    requires:
      "A support plan built from the assessment within the required timeframe that addresses each identified need, is signed by the required parties, is followed in practice, and is revised when the assessment changes.",
    why:
      "The plan is late, doesn't address a need the assessment flagged, isn't signed, or -- most consequentially -- isn't actually followed. When a resident's care doesn't match their own support plan, surveyors cite the gap. Reassessments that never flow into an updated plan are a frequent finding.",
    avoid:
      "Generate the plan from the assessment so nothing is dropped, get every required signature, and re-open the plan every time a reassessment changes the picture.",
    carebase:
      "Automatic support-plan triggers build the plan straight from the assessment so no flagged need is dropped, and re-open it the moment a reassessment changes the picture — keeping the plan and the resident's actual care in sync.",
  },
  {
    rank: 12,
    icon: BedDouble,
    sections: "§2600.101 · §2800.101",
    title: "Resident bedrooms & living units",
    pch: null,
    alf: "2.96%",
    note: "ALF top ten",
    requires:
      "Bedrooms (PCH) and living units (ALF) that meet space, occupancy, furnishing, and condition standards -- and, for ALF units, the additional living-unit features the chapter requires.",
    why:
      "Occupancy above what the room's square footage allows, missing required furnishings, or rooms in poor repair. Chapter 2800 sets a higher bar for ALF living units, so assisted living earns this citation more often than personal care.",
    avoid:
      "Verify square footage against occupancy before assigning a room, keep required furnishings in place, and fold bedrooms into the routine maintenance and repair cycle.",
    carebase:
      "The living-unit standard still needs the building — but CareBase's facility and maintenance records document room condition and required furnishings and route repairs to closure, so the upkeep is provable at survey.",
  },
  {
    rank: 13,
    icon: Pill,
    sections: "§2600.181 · §2800.181",
    title: "Self-administration of medications",
    pch: null,
    alf: null,
    note: "Perennial — medication cluster",
    requires:
      "Before a resident self-administers medication, a documented determination that they are capable of doing so safely, with reassessment when their condition changes and secure storage of self-administered drugs.",
    why:
      "A resident keeps and takes their own medication with no assessment on file showing they can do it safely, or the capability was assessed once and never revisited as the resident declined. Part of the medication cluster that -- across records, storage, accountability, and self-administration -- drives more citations than any other subject in Pennsylvania.",
    avoid:
      "Document a self-administration capability assessment before allowing it, reassess on any change of condition, and address where and how self-administered medication is stored.",
    carebase:
      "CareBase's digital assessment captures each self-administration capability determination and re-triggers it on a change of condition, so no resident self-medicates without a current one on file.",
  },
  {
    rank: 14,
    icon: HeartPulse,
    sections: "§2600.142 · §2800.142",
    title: "Assistance with health care & medical care",
    pch: null,
    alf: null,
    note: "Perennial — 2022 top finding",
    requires:
      "When staff assist with medications or health care, they follow the prescriber's directions exactly, hold the required medication-administration training, and arrange the supplemental health services a resident needs.",
    why:
      "In the 2022 report, not following the prescriber's directions when administering medication was the single most common finding statewide. Surveyors cite the wrong dose, time, or route; staff assisting with medications without the DHS-approved training and passing test score; and needed health services that were never arranged.",
    avoid:
      "Let only medication-trained, currently-certified staff assist with medications, hold them to the exact order, and build a clear path for arranging the outside health care residents need.",
    carebase:
      "The med-admin roster confirms only medication-trained, currently-certified staff are assisting with medications, and medication-event integration catches any administration that strays from the prescriber's order.",
  },
  {
    rank: 15,
    icon: AlertTriangle,
    sections: "§2600.16 · §2800.16",
    title: "Reportable incidents & conditions",
    pch: null,
    alf: null,
    note: "Perennial — 2022 top finding",
    requires:
      "Reporting defined incidents and conditions -- death, serious injury, hospitalization, medication errors, abuse, elopement, and more -- to the DHS regional office within the required timeframe and by the required means, with documented follow-up.",
    why:
      "The 2022 report named late or missing reporting -- incidents not reported within 24 hours -- as a top-three finding. Surveyors cite reportable events that were never filed, filed late, or filed without the required follow-up and corrective action. Because BHSL receives tens of thousands of incident reports a year, gaps are easy to spot against the record.",
    avoid:
      "Give every shift a plain-language list of what's reportable and the deadline, log the report time against the event time, and document the corrective action that followed.",
    carebase:
      "Incident & complaint tracking starts the regulatory notification clock the instant an event is logged and counts down to the DHS deadline — closing the exact 24-hour reporting gap the 2022 report flagged, with the corrective-action trail attached.",
  },
];

const PCH_TOP_10 = [
  ["§2600.187", "Medication records", "7.57%"],
  ["§2600.65", "Direct care staff person training and orientation", "5.40%"],
  ["§2600.183", "Storage and disposal of medications and medical supplies", "5.34%"],
  ["§2600.103", "Food service", "4.60%"],
  ["§2600.132", "Fire drills", "4.35%"],
  ["§2600.185", "Accountability of medication and controlled substances", "4.23%"],
  ["§2600.42", "Specific rights", "3.92%"],
  ["§2600.85", "Sanitation", "3.71%"],
  ["§2600.225", "Initial and annual assessment", "3.67%"],
  ["§2600.141", "Resident medical evaluation and health care", "3.54%"],
] as const;

const ALF_TOP_10 = [
  ["§2800.65", "Direct care staff person training and orientation", "6.88%"],
  ["§2800.187", "Medication records", "6.12%"],
  ["§2800.132", "Fire drills", "6.02%"],
  ["§2800.183", "Storage and disposal of medications and medical supplies", "5.64%"],
  ["§2800.42", "Specific rights", "4.68%"],
  ["§2800.103", "Food service", "4.40%"],
  ["§2800.85", "Sanitation", "3.54%"],
  ["§2800.185", "Accountability of medication and controlled substances", "3.44%"],
  ["§2800.227", "Development of the final support plan", "3.25%"],
  ["§2800.101", "Resident living units", "2.96%"],
] as const;

const HOW_CITATIONS_WORK = [
  {
    label: "How a citation happens",
    body:
      "A personal care home must comply with roughly 500 individual regulatory requirements; an assisted living residence with even more. When a licensing inspector finds non-compliance with any one of them, they record a violation against that section. A full inspection measures every regulation at once.",
  },
  {
    label: "Correction timeframes",
    body:
      "Uncorrected violations can carry administrative fines classified by urgency: Class I (correct within 24 hours), Class II (within 5 days), and Class III (within 15 days). The citation itself is the notice; the clock to correct it starts right away.",
  },
  {
    label: "When it escalates",
    body:
      "Substantial but incomplete compliance can drop a home to a provisional (warning) license, renewable up to three times. Serious life-safety conditions -- abuse, neglect, fire risk, no food or utilities -- can trigger enforcement up to revocation or emergency relocation.",
  },
  {
    label: "Why documentation dominates",
    body:
      "Look at the top of the list: medication records, training records, drill logs, assessments, support plans. Most citations aren't about care that never happened -- they're about care that happened but wasn't proven on paper the way the regulation requires.",
  },
] as const;

const SOURCES = [
  {
    label: "DHS BHSL 2025 Annual Report (PCH & ALR) — citation rankings",
    href: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/providers/clearances-and-licensing/documents/pch-residential-licensing/2026-06-22-bhsl-annual-report-2025-final.pdf",
  },
  {
    label: "DHS BHSL 2024 Annual Report (PCH & ALR)",
    href: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/providers/clearances-and-licensing/documents/pch-residential-licensing/2025-09-04-2024-bhsl-annual-report.pdf",
  },
  {
    label: "Personal Care Home & Assisted Living Residence reports (all years)",
    href: "https://www.pa.gov/agencies/dhs/resources/for-providers/ltc-providers/personal-care-home-reports",
  },
  {
    label: "55 Pa. Code Chapter 2600 — Personal Care Homes",
    href: "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2600/chap2600toc.html",
  },
  {
    label: "55 Pa. Code Chapter 2800 — Assisted Living Residences",
    href: "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2800/chap2800toc.html",
  },
] as const;

function RateBadge({ label, value }: { label: string; value: Rate }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-baseline gap-1 rounded-md border border-[#dfe6ee] bg-[#fafbfc] px-2 py-1">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[#5d7084]">
        {label}
      </span>
      <span className="font-mono text-[13px] font-bold text-[#0d2742]">{value}</span>
    </span>
  );
}

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

function CitationCard({ item }: { item: Citation }) {
  const Icon = item.icon;
  return (
    <article className="relative overflow-hidden rounded-2xl border border-[#dfe6ee] bg-white">
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eaf3fc] text-primary">
            <Icon className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-[#5d7084]">
                #{item.rank}
              </span>
              <span className="font-mono text-[11px] font-semibold text-primary">
                {item.sections}
              </span>
            </div>
            <h3 className="mt-0.5 text-[17px] font-bold leading-tight text-[#0d2742]">
              {item.title}
            </h3>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <RateBadge label="PCH" value={item.pch} />
            <RateBadge label="ALF" value={item.alf} />
            {!item.pch && !item.alf && item.note && (
              <span className="inline-flex items-center rounded-md border border-[#f0d9a8] bg-[#fdf7ea] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[#6d5312]">
                {item.note}
              </span>
            )}
          </div>
        </div>

        {(item.pch || item.alf) && item.note && (
          <p className="-mt-1 font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#8a99a8]">
            {item.note}
          </p>
        )}

        <div className="grid gap-3.5 sm:grid-cols-3">
          <div>
            <h4 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#5d7084]">
              What the rule requires
            </h4>
            <p className="mt-1.5 text-[13px] leading-6 text-[#44566b]">{item.requires}</p>
          </div>
          <div>
            <h4 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#a83a2c]">
              Why surveyors cite it
            </h4>
            <p className="mt-1.5 text-[13px] leading-6 text-[#44566b]">{item.why}</p>
          </div>
          <div>
            <h4 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#1f7a4d]">
              Stay clear
            </h4>
            <p className="mt-1.5 text-[13px] leading-6 text-[#44566b]">{item.avoid}</p>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-[#cfe2f4] bg-[#eaf3fc] px-4 py-3">
          <ShieldCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" />
          <div>
            <h4 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-primary">
              How CareBase helps prevent it
            </h4>
            <p className="mt-1 text-[13px] leading-6 text-[#2c4a68]">{item.carebase}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function OfficialTable({
  heading,
  rows,
  headLabel,
}: {
  heading: string;
  rows: readonly (readonly [string, string, string])[];
  headLabel: string;
}) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#dfe6ee] bg-white">
      <div className="border-b border-[#eef2f6] bg-[#fafbfc] px-[18px] py-3">
        <h3 className="text-[14px] font-bold text-[#0d2742]">{heading}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[420px] border-collapse text-[13px]">
          <thead className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#5d7084]">
            <tr>
              <th className="border-b border-[#eef2f6] px-[18px] py-2.5 text-left font-semibold">
                §
              </th>
              <th className="border-b border-[#eef2f6] px-2 py-2.5 text-left font-semibold">
                Requirement
              </th>
              <th className="border-b border-[#eef2f6] px-2 py-2.5 pr-[18px] text-right font-semibold">
                {headLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([section, requirement, rate]) => (
              <tr key={section} className="border-b border-[#eef2f6] last:border-b-0">
                <th className="px-[18px] py-2.5 text-left font-mono text-xs font-semibold text-primary">
                  {section}
                </th>
                <td className="px-2 py-2.5 text-[#44566b]">{requirement}</td>
                <td className="px-2 py-2.5 pr-[18px] text-right font-mono font-bold text-[#0d2742]">
                  {rate}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PaDhsCitations() {
  usePageMeta({
    ...MARKETING_ROUTE_META["/pa-dhs-citations"],
    path: "/pa-dhs-citations",
  });

  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="relative mx-auto flex max-w-[900px] flex-col items-center gap-4 px-4 py-16 text-center sm:px-6 lg:px-8">
          <Reveal>
            <span className="inline-flex rounded-full border border-white/20 bg-white/[0.08] px-3.5 py-1.5 text-xs font-bold text-[#b9e4ff]">
              Free resource · 2025 BHSL data, published 2026
            </span>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight text-balance sm:text-[42px]">
              The 15 most common DHS citations for PA personal care &amp; assisted living
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto max-w-[62ch] text-[17px] leading-7 text-white/85 text-pretty">
              What Pennsylvania DHS surveyors write up most often under 55 Pa.
              Code Chapters 2600 and 2800 — the actual regulation, why the
              citation gets issued, and how to stay clear of it. Ranked from the
              Bureau of Human Services Licensing 2025 Annual Report.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[1040px] px-4 py-14 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              The short version
            </h2>
            <p className="mt-2 max-w-[74ch] text-[14.5px] leading-7 text-[#44566b]">
              Across every Pennsylvania personal care home (PCH) and assisted
              living facility (ALF), the same handful of regulations produce the
              bulk of citations year after year — and they cluster in three
              places: <strong>medications</strong> (records, storage,
              accountability, self-administration), <strong>staff training</strong>,
              and <strong>life-safety and documentation</strong> (fire drills,
              assessments, support plans). The pattern is consistent: most
              citations aren&apos;t about care that never happened — they&apos;re about
              care that wasn&apos;t documented the way the regulation demands.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[#dfe6ee] bg-[#fafbfc] p-4">
                <div className="font-serif text-[30px] font-bold leading-none text-[#0d2742]">
                  ~500
                </div>
                <p className="mt-2 text-[13px] leading-5 text-[#44566b]">
                  individual regulatory requirements a PCH must meet — an ALF,
                  more.
                </p>
              </div>
              <div className="rounded-xl border border-[#dfe6ee] bg-[#fafbfc] p-4">
                <div className="font-serif text-[30px] font-bold leading-none text-[#0d2742]">
                  #1
                </div>
                <p className="mt-2 text-[13px] leading-5 text-[#44566b]">
                  most-cited section statewide, both settings:{" "}
                  <span className="font-mono text-xs">§_.187</span>, medication
                  records.
                </p>
              </div>
              <div className="rounded-xl border border-[#dfe6ee] bg-[#fafbfc] p-4">
                <div className="font-serif text-[30px] font-bold leading-none text-[#0d2742]">
                  ~40%
                </div>
                <p className="mt-2 text-[13px] leading-5 text-[#44566b]">
                  of top-ten citations tie directly to medication handling and
                  its paper trail.
                </p>
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.12}>
            <div className="mt-5 flex items-start gap-2.5 rounded-[10px] border border-[#f0d9a8] bg-[#fdf7ea] px-[18px] py-3.5 text-[13px] leading-6 text-[#6d5312]">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Informational, not legal advice. &ldquo;Percent of inspections cited&rdquo;
                is the share of licensing inspections in which a section was
                cited at least once in 2025 — not a per-facility guarantee.
                Verify against the current regulations (linked below) and your
                DHS regional office.
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-[#f6f8fa]">
        <div className="mx-auto max-w-[1040px] px-4 py-14 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              The top 15, and why they get written
            </h2>
            <p className="mt-1.5 max-w-[74ch] text-[14.5px] leading-6 text-[#44566b]">
              Ordered by the higher of the PCH or ALF citation rate in the 2025
              report. Each badge is the percent of that setting&apos;s 2025
              inspections in which the section was cited — and each card ends
              with how CareBase closes that specific gap before a surveyor finds
              it.
            </p>
          </Reveal>
          <div className="mt-6 flex flex-col gap-3.5">
            {TOP_15.map((item, index) => (
              <Reveal key={item.rank} delay={Math.min(index * 0.03, 0.12)}>
                <CitationCard item={item} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[1040px] px-4 py-14 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              How a DHS citation actually works
            </h2>
            <p className="mt-1.5 max-w-[74ch] text-[14.5px] leading-6 text-[#44566b]">
              A citation is a recorded violation of one regulatory requirement.
              What happens next depends on severity and how fast it&apos;s corrected.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {HOW_CITATIONS_WORK.map((item) => (
                <article key={item.label} className="rounded-xl border border-[#dfe6ee] p-[18px]">
                  <h3 className="font-mono text-[11px] font-semibold uppercase text-primary">
                    {item.label}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-6 text-[#44566b]">{item.body}</p>
                </article>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-[#f6f8fa]">
        <div className="mx-auto max-w-[1040px] px-4 py-14 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              The official 2025 rankings
            </h2>
            <p className="mt-1.5 max-w-[74ch] text-[14.5px] leading-6 text-[#44566b]">
              DHS publishes a separate &ldquo;Ten Most Frequently Cited Violations&rdquo;
              list for each setting. Here they are verbatim, as of December 31,
              2025 — the source behind the ranking above.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <OfficialTable
                heading="Personal care homes — 55 Pa. Code Ch. 2600"
                rows={PCH_TOP_10}
                headLabel="% of insp."
              />
              <OfficialTable
                heading="Assisted living facilities — 55 Pa. Code Ch. 2800"
                rows={ALF_TOP_10}
                headLabel="% of insp."
              />
            </div>
          </Reveal>
          <Reveal delay={0.12}>
            <div className="mt-5 rounded-[10px] border border-[#dfe6ee] bg-white px-[18px] py-3.5 text-[13px] leading-6 text-[#44566b]">
              The two lists share eight of ten sections — the citation pattern is
              nearly identical across PCH and ALF. Ranks 11–15 above draw on the
              same report&apos;s medication and incident-reporting findings and the
              prior-year (2024, 2022) tables, so the fifteen cover what surveyors
              write beyond each setting&apos;s published top ten.
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#e5eaf0] bg-white">
        <div className="mx-auto max-w-[1040px] px-4 py-14 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[26px] font-bold text-[#0d2742]">
              Primary sources
            </h2>
            <p className="mt-1.5 text-[14.5px] leading-6 text-[#44566b]">
              Every figure on this page traces to a DHS report or the regulation
              itself.
            </p>
            <div className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {SOURCES.map((source) => (
                <ExternalSourceLink key={source.href} {...source} />
              ))}
            </div>
            <p className="mt-6 text-[13.5px] leading-6 text-[#44566b]">
              Pairs with our{" "}
              <Link
                href="/pa-training-requirements"
                className="font-semibold text-primary hover:underline"
              >
                PA annual training requirements guide
              </Link>{" "}
              — the §_.65 training citation is the second most common in the
              state, and that guide breaks down exactly what the hours have to
              cover.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#cfe2f4] bg-[#eaf3fc]">
        <div className="mx-auto flex max-w-[720px] flex-col items-center gap-3 px-4 py-10 text-center sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-serif text-[22px] font-bold text-[#0d2742]">
              Keep this guide
            </h2>
            <p className="mx-auto mt-2 max-w-[54ch] text-sm leading-6 text-[#44566b]">
              Print it for the survey binder or the next in-service — and check
              back when DHS publishes the next annual report.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <Button type="button" className="gap-2" onClick={() => window.print()}>
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
              CareBase closes these gaps before a surveyor finds them
            </h2>
            <p className="mx-auto mt-3 max-w-[56ch] text-[15px] leading-7 text-white/82">
              Medication records, training hours, fire-drill logs, assessments,
              and support plans — tracked continuously, flagged before they
              lapse, and pulled into a survey-ready binder on demand.
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
                <Link href="/pa-training-requirements">See the training guide</Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingLayout>
  );
}
