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
 * tables for PCH and ALF, published June 2026 (the most recent citation data
 * available). "Percent of inspections cited" is the share of licensing
 * inspections in which that section was cited at least once. Entries are
 * ordered by the higher of the PCH or ALF 2025 rate; where one setting's 2025
 * table omits a section, the badge carries its 2024 rate instead. Rank 15,
 * incident reporting, comes from the 2022 PCH table (§2600.16(c), 12%). Ranks 13
 * and 14 -- self-administration and assistance with health care -- appear in
 * none of the 2022, 2023, 2024 or 2025 top-ten tables and are labelled as
 * context, not ranking. This page is informational, not legal advice. "ALF" is
 * this org's term for the Chapter 2800 facility type (the regulation itself
 * says "assisted living residence").
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
      "A complete, accurate medication administration record (MAR) for every resident: the drug, dose, route, time, the prescriber's order behind it, and a staff initial for every dose given, refused, or held -- recorded at the time it's given. The prescriber's directions are followed, and a refused dose is documented and reported to the prescriber within 24 hours unless the prescriber has said otherwise.",
    why:
      "The highest single citation rate in Pennsylvania personal care homes in 2025, and second for assisted living. Surveyors find blank boxes on the MAR (a dose with no initial can't be proven given), doses initialed at the wrong time, PRN medications with no reason or effect documented, discontinued drugs still listed, or a MAR that doesn't match the current physician order. One subsection stands out: in DHS's 2022 report, §2600.187(d) -- \"The home shall follow the directions of the prescriber\" -- was cited in 18% of PCH inspections. The care may have happened -- but if it isn't documented correctly, the regulation treats it as not done.",
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
      "Fire-safety and emergency orientation on or before the first work day; resident rights, the emergency medical plan, abuse reporting and incident reporting within 40 scheduled working hours; the DHS-approved direct care training and competency test before unsupervised care (and in an ALF, a DHS-approved orientation plus first aid and CPR before any direct care); then annual training -- 12 hours per direct care worker in a PCH, 16 hours in an ALF -- with dementia hours on top where they apply.",
    why:
      "Cited when a personnel file can't prove the hours: annual training completed late or short of the minimum, orientation missing or undated, no record of the topics covered, or dementia-specific hours absent for staff on a secured or special-care unit. Surveyors count documented hours -- an untracked in-service didn't happen.",
    avoid:
      "Track hours per employee against their hire-date anniversary, tie completion to signed rosters that name the subject and duration, and flag anyone approaching their window before it closes.",
    carebase:
      "Facility administrators build yearly plans, choose the courses their staff need, and enter the completion deadline. They can apply the course bundle to selected staff together and follow completion progress across the roster.",
  },
  {
    rank: 3,
    icon: Flame,
    sections: "§2600.132 · §2800.132",
    title: "Fire drills",
    pch: "4.35%",
    alf: "6.02%",
    requires:
      "An unannounced fire drill at least once a month, on different days of the week and at different times of day and night, with one during sleeping hours at least every six months. Each drill sets off the fire alarm or a smoke detector, uses alternate exit routes, and evacuates residents to the designated meeting place within the time a fire safety expert set in writing within the past year. The written record must show the date, time, evacuation time, exit route used, residents in the building and residents evacuated, staff participating, problems encountered, and whether the alarm or detector worked. A fire safety expert also runs one drill and a fire safety inspection every year.",
    why:
      "One of the easiest citations to earn on paper. Drills bunched on the day shift or held when extra staff are on, months with no drill, evacuation times over the expert's standard with no corrective note, the same exit used every time, or drill logs missing a required field such as the exit route or whether the alarm worked. The six-monthly sleeping-hours drill is an easy one to let slip.",
    avoid:
      "Plan the year's drills across days, shifts, and months without announcing them, put a sleeping-hours drill on the calendar every six months, rotate the exit route, and record every required field -- including problems encountered -- every single time, even when the drill goes well.",
    carebase:
      "The fire-drill & life-safety log records every field the regulation lists, tracks the monthly drill and the six-month sleeping-hours drill as separate due dates, and warns when the two most recent drills used the same shift or exit route — so the bunched-up, day-shift-only pattern is visible before a surveyor sees it.",
  },
  {
    rank: 4,
    icon: Lock,
    sections: "§2600.183 · §2800.183",
    title: "Storage & disposal of medications & medical supplies",
    pch: "5.34%",
    alf: "5.64%",
    requires:
      "Medications kept in their original labeled containers and not removed more than two hours before they're given. Prescription and OTC medications and syringes kept in a locked area or container -- refrigerated ones included, and in a PCH, those kept in a resident's room. Storage organized and at the temperature, moisture, and light the manufacturer specifies; only current medications for people living in the home kept on site; discontinued and expired medications destroyed safely; and a resident who moves out permanently leaves with their medications that day.",
    why:
      "Surveyors open the med cart and the fridge. Common findings: an unlocked cart, med room, or medication refrigerator; doses set out hours ahead; insulin or other drugs stored outside the manufacturer's temperature range; expired or discontinued medications still in stock; or a departed resident's drugs still on the shelf.",
    avoid:
      "Keep a thermometer in the medication refrigerator and log it, pull expired and discontinued stock on a set schedule, never set doses out more than two hours ahead, and record how and when each discontinued drug was destroyed. DHS's compliance guide also recommends -- without requiring -- double-locking controlled substances.",
    carebase:
      "CareBase's recurring checks can carry the medication-refrigerator temperature log, expiration pulls, and destruction routine, each with a dated record, so the routine is provable when the surveyor opens the cart.",
  },
  {
    rank: 5,
    icon: Scale,
    sections: "§2600.42 · §2800.42",
    title: "Specific rights (resident rights)",
    pch: "3.92%",
    alf: "4.68%",
    requires:
      "Each resident's specific rights honored in practice: no discrimination; no neglect, intimidation, abuse, mistreatment, corporal punishment, or discipline of any kind; dignity and respect; a private phone and unopened mail; access to the ombudsman; their own clothing and possessions; freedom to come and go consistent with the home rules and their support plan; and freedom from restraints.",
    why:
      "DHS breaks this citation down, and two subsections dominate. In 2025, §42(b) -- a resident neglected, intimidated, abused, mistreated, or disciplined -- was cited 372 times, and §42(c), dignity and respect, 152 times. Mail opened, calls monitored, possessions restricted, or privacy ignored during care are cited here too.",
    avoid:
      "Train staff that neglect includes failing to provide the care the home agreed to provide -- and that a single incident counts -- treat every allegation as reportable from the moment it's made, and make dignity, privacy, and access operational rules, not slogans. (The signed acknowledgment that a resident received their rights at admission is a separate section, §2600.41 · §2800.41.)",
    carebase:
      "Incident & complaint tracking puts every allegation of neglect or mistreatment on the reporting clock the moment it's logged, and policy-attestation campaigns capture the signed rights acknowledgment at admission with ESIGN/UETA documentation.",
  },
  {
    rank: 6,
    icon: UtensilsCrossed,
    sections: "§2600.103 · §2800.103",
    title: "Food service",
    pch: "4.60%",
    alf: "4.40%",
    requires:
      "An operable kitchen with nonporous surfaces sanitized after each meal. Food protected from contamination, stored off the floor in closed or sealed containers, refrigerated at or below 40°F and frozen at or below 0°F, with a thermometer in every refrigerator and freezer. Leftovers labeled and dated, food returned from a plate never served again, no outdated or spoiled food or dented cans, safe thawing, and utensils washed, rinsed, and sanitized after each use. (The menu rules -- nutritional adequacy, posted weekly menus, substitutions, and no more than 15 hours between the evening meal and the next day's first meal -- are §2600.161–.162 · §2800.161–.162.)",
    why:
      "A kitchen walk-through citation: a refrigerator or freezer with no thermometer or running warm, unlabeled or undated leftovers, food on the floor or in open containers, outdated stock or dented cans on the shelf, or surfaces and utensils not sanitized. Surveyors see it with their own eyes, so it's hard to explain away after the fact.",
    avoid:
      "Keep a thermometer in every refrigerator and freezer and log the readings, label and date leftovers every time, clear outdated food and dented cans on a set schedule, and keep everything covered and off the floor.",
    carebase:
      "Dietary & food-safety operations log refrigerator and freezer temperatures against their limits, run food-storage, expiration, and sanitation rounds with a dated record, and route every out-of-range reading to a corrective action — the exact checks this section is written up for.",
  },
  {
    rank: 7,
    icon: ClipboardList,
    sections: "§2600.185 · §2800.185",
    title: "Accountability of medication & controlled substances",
    pch: "4.23%",
    alf: "3.44%",
    requires:
      "Written procedures, actually followed, for the safe storage, access, security, distribution, and use of medications and medical equipment by trained staff. At a minimum they must cover documenting receipt of controlled substances and prescription medications, investigating and accounting for missing medications and medication errors, limiting access to medication storage, and documenting every medication administered or assisted. An ALF must also keep an adequate supply of each resident's prescribed medication on hand where the support plan calls for it.",
    why:
      "In DHS's 2022 report, §2600.185(a) -- developing and implementing these procedures -- was the most-cited subsection of all, in 21% of PCH inspections. Surveyors find no written procedure, a procedure that says nothing about missing medications or errors, a delivery never logged in, an unexplained shortfall never investigated, or storage anyone can walk into. It's the accountability half of the medication rules -- separate from the storage citation, and often cited alongside it.",
    avoid:
      "Write the four required procedures down and follow them: log every delivery, investigate and document every missing dose or error, and limit who holds the keys. DHS's compliance guide also recommends -- without requiring -- double-locking controlled substances and counting them every shift, with two staff and a supervisor documenting the count.",
    carebase:
      "Medication-event integration imports each dose's administration status from your eMAR and flags every refused, held, missed, or late dose — so the administration record this section requires can be reviewed in one place instead of binder by binder.",
  },
  {
    rank: 8,
    icon: Droplets,
    sections: "§2600.85 · §2800.85",
    title: "Sanitation",
    pch: "3.71%",
    alf: "3.54%",
    requires:
      "Sanitary conditions throughout, no evidence of insects or rodents, trash removed from the premises at least weekly and kept in covered receptacles that keep pests out -- in kitchens, in bathrooms, and outside -- and, for a home serving 9 or more residents that isn't on a public sewer, written approval of its sewage system from the municipality's sewage enforcement official.",
    why:
      "A walk-through citation: evidence of insects or rodents, soiled bathrooms or common areas, uncovered trash in a kitchen or bathroom, or overflowing outdoor receptacles. These are visible on inspection day and hard to explain away after the fact. (Scalding water is a separate rule: hot water in areas residents can reach may not exceed 120°F, §2600.89(b) · §2800.89(b).)",
    avoid:
      "Run a documented cleaning schedule, keep a pest-control contract with service records, put lids on every kitchen and bathroom trash can, and confirm weekly trash removal -- and while you're walking the building, check hot water at resident fixtures against the 120°F maximum.",
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
      "A written initial assessment on the DHS form (or one with the same content) -- in a PCH within 15 days of admission, in an ALF within 30 days before admission -- then again annually, whenever the resident's condition significantly changes, and when DHS asks. Each one fully completed, signed, and dated, covering every required domain.",
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
      "A medical evaluation by a physician, physician assistant, or CRNP on the DHS form -- in a PCH within 60 days before or 30 days after admission; in an ALF within 60 days before admission (or 15 days after, for a direct hospital admission, an escape from abuse, or no alternative living arrangement). It covers diagnosis, allergies, immunization history, medications and the ability to self-administer, mobility, and the rest of the form, and it's repeated at least annually and whenever the resident's medical condition changes before then. In an ALF it also records a tuberculin skin test from the past two years (a chest X-ray if positive), given within 15 days after admission if there isn't one.",
    why:
      "The admission or annual evaluation is missing, incomplete, or done outside the allowed window; no new evaluation followed a clear change in condition; the examiner never signed the form; or, in an ALF, the tuberculin result isn't there. In DHS's 2022 report the initial evaluation, §2600.141(a), was the third most-cited subsection, in 15% of PCH inspections.",
    avoid:
      "Treat the initial medical evaluation -- with the TB result in an ALF -- as part of admission, track annual evaluations like any other renewal, request a new one when the resident's condition changes, and confirm the examiner signed before filing.",
    carebase:
      "CareBase opens the initial medical evaluation deadline the day a resident is admitted and tracks the annual like any other renewal — flagging a missing or overdue DHS form long before the surveyor asks for it.",
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
    note: "Context — not in a 2022–25 top ten",
    requires:
      "A resident who wants to self-administer is assessed by a physician, physician assistant, or CRNP on their ability to do so and their need for reminders; to count as capable they must recognize their medications and know how much to take and when. The home still helps as needed -- reminders, secure storage, offering the medication at the prescribed times -- keeps a current medication list in the resident's record, and keeps medication in the room locked (PCH) or in a lockable unit the residence provides (ALF).",
    why:
      "Not a top-ten section itself, but the gate to the medication rules that are: a resident keeps and takes their own medication with no prescriber assessment on file, no current medication list in the record, medication in the room unsecured, or a capability assessed once and never revisited as the resident declined.",
    avoid:
      "Get the prescriber's self-administration assessment before allowing it, reassess on any change of condition, keep a current medication list in the record, and check that in-room medication is locked.",
    carebase:
      "CareBase's digital assessment records whether each resident can self-administer, and a change of condition opens a reassessment — so a capability decision made once doesn't quietly go stale.",
  },
  {
    rank: 14,
    icon: HeartPulse,
    sections: "§2600.142 · §2800.142",
    title: "Assistance with health care & medical care",
    pch: null,
    alf: null,
    note: "Context — not in a 2022–25 top ten",
    requires:
      "When a resident's health declines, the home helps them get medical care and documents the need, including updating the assessment and support plan. A refusal of routine medical or dental care is documented along with continued efforts to educate the resident; reasonable efforts are made to get consent to treat a serious condition; and the home helps secure the preventive medical, dental, vision, and behavioral health care a physician, physician assistant, or CRNP requests. An ALF must also show it can provide or arrange supplemental health care services, and must let residents choose or keep their own primary care physician.",
    why:
      "Not a top-ten section itself, but the follow-through between the medical evaluation (§141) and the support plan (§227): the record shows a decline -- repeated falls, weight loss, a hospital visit -- with no care arranged and no update to the assessment or support plan, or a resident's refusal of care was never documented with the staff's continued efforts to inform them. (The 2022 report's prescriber-directions finding is a medication-records citation, §2600.187(d), covered at #1.)",
    avoid:
      "Treat a decline in health as a trigger: arrange the care, then update the assessment and support plan. Document every refusal and every follow-up conversation, and track the preventive referrals a prescriber requests until they're done.",
    carebase:
      "Rule-based change detection flags repeated falls, weight change, reduced meal intake, refusals, and hospital visits for a named review, and a significant change opens a reassessment — so a decline shows up while there's still time to arrange care and update the plan.",
  },
  {
    rank: 15,
    icon: AlertTriangle,
    sections: "§2600.16 · §2800.16",
    title: "Reportable incidents & conditions",
    pch: null,
    alf: null,
    note: "2022 PCH top ten",
    requires:
      "Reporting defined incidents and conditions -- a death, a serious injury needing hospital treatment, a prescription medication error, suspected abuse, an unexplained absence, and more -- to the DHS licensing office or complaint hotline within 24 hours in the manner DHS designates (an ALF also tells the resident's family and designated person immediately), then a final report when the investigation concludes, with affected residents informed if it's validated.",
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
    label: "What triggers a citation",
    body:
      "A personal care home must comply with roughly 500 individual regulatory requirements; an assisted living facility with even more. When a licensing inspector finds non-compliance with any one of them, they record a violation against that section. A full inspection measures every regulation at once.",
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
    label: "DHS BHSL 2025 Annual Report (PCH & ALF) — citation rankings",
    href: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/providers/clearances-and-licensing/documents/pch-residential-licensing/2026-06-22-bhsl-annual-report-2025-final.pdf",
  },
  {
    label: "DHS BHSL 2024 Annual Report (PCH & ALF)",
    href: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/providers/clearances-and-licensing/documents/pch-residential-licensing/2025-09-04-2024-bhsl-annual-report.pdf",
  },
  {
    label: "DHS BHSL 2022 Annual Report (PCH) — subsection-level citation rates",
    href: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2022%20BHSL%20PCH%20Annual%20Report.pdf",
  },
  {
    label: "Personal Care Home & Assisted Living Facility reports (all years)",
    href: "https://www.pa.gov/agencies/dhs/resources/for-providers/ltc-providers/personal-care-home-reports",
  },
  {
    label: "55 Pa. Code Chapter 2600 — Personal Care Homes",
    href: "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2600/chap2600toc.html",
  },
  {
    label: "55 Pa. Code Chapter 2800 — Assisted Living Facilities (ALF)",
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
          <p className="-mt-1 font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#5d7084]">
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
      <div role="region" aria-label={heading} tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
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
              accountability), <strong>staff training</strong>,
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
                  most-cited section for personal care homes (and #2 for assisted
                  living): <span className="font-mono text-xs">§_.187</span>,
                  medication records.
                </p>
              </div>
              <div className="rounded-xl border border-[#dfe6ee] bg-[#fafbfc] p-4">
                <div className="font-serif text-[30px] font-bold leading-none text-[#0d2742]">
                  ~1 in 3
                </div>
                <p className="mt-2 text-[13px] leading-5 text-[#44566b]">
                  top-ten citations tie directly to medication handling and its
                  paper trail — three of each setting&apos;s ten sections.
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
              nearly identical across PCH and ALF. Ranks 11 and 12 come from the
              ALF list, with the 2024 PCH rate where one exists, and rank 15,
              incident reporting, from the 2022 PCH table. Ranks 13 and 14 are
              in none of the 2022–2025 top-ten tables: they are the
              self-administration and health-care rules that sit next to the
              most-cited medication and evaluation sections, included as
              context rather than ranking.
              <br />
              <br />
              This page ranks what is cited most often. It is not an index of
              every section CareBase tracks: administrator qualification and
              continuing education (§2600.64 · §2800.64), for one, is governed in
              the product and referenced by the regulatory crosswalk without
              appearing here, because it is not among the most-cited sections.
              Ranking it would say something about surveyor findings that the
              published data does not support.
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
