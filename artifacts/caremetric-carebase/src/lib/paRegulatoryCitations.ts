/**
 * Governed PA regulatory citation library for the resident assessment and support-plan scope
 * (program plan Phase 2a).
 *
 * WHERE THIS CONTENT COMES FROM. Nothing here is authored from memory. Every citation and every
 * deadline statement is carried forward from data this repository already verified against the
 * regulation and shipped:
 *
 *   - `resident_compliance_rule_packs` (20260706155617) -- per facility type, item type, and
 *     admission track, with `citation_ref` and a `notes` column that records "confirmed" versus
 *     "pending confirmation" explicitly.
 *   - `dhs_citation_topics` (20260705184221, 20260706143020, 20260706155617) -- chapter/citation
 *     taxonomy whose `notes` carry the same verification language.
 *   - `dhsFormsLibrary.ts` -- the official pa.gov form each requirement is proven with, already
 *     covered by the live link check in `scripts/check-dhs-sources.mjs`.
 *
 * That provenance matters more than coverage. An invented or half-remembered citation shown next to
 * an assessment field is worse than no citation at all, so this library is deliberately narrow: it
 * covers only what the repo has already confirmed, and it carries `pending_confirmation` forward
 * where the source data says the point is unconfirmed rather than quietly upgrading it.
 *
 * WHAT THIS IS NOT. `regulatory_rule_versions` is the governed engine for *calculable* rules
 * (applicability, calculation parameters, shadow runs, golden fixtures). This library is a
 * *reference* layer: what a section requires, who is responsible, and what evidence proves it.
 * The two are complementary; this file does not duplicate rule computation.
 *
 * Per this org's terminology convention (facilityTypes.ts), user-facing text says "Assisted Living
 * Facility (ALF)" even where the regulation's own title says "Assisted Living Residence". The
 * stored facility-type code stays "ALR".
 */
import type { FacilityType } from "./facilityTypes";

/** Human review date for this catalog. Surfaced in the UI so the library shows its own staleness. */
export const PA_CITATIONS_LAST_VERIFIED = "2026-08-04";

/**
 * Matches the review cadence `scripts/check-dhs-sources.mjs` enforces for the form library --
 * and, since the module note at the bottom of this file, that script enforces this gate too, the
 * same way it already does for the form library. Every surface that renders guidance also calls
 * `isCitationLibraryStale()` directly, so staleness is visible at the point of use as well as in CI.
 */
export const CITATION_REVIEW_MAX_AGE_DAYS = 45;

/**
 * The governed statuses `dhs_citation_topics.verification_status` may hold. Mirrored here so the
 * display helpers below can be pure and tested, not so this module can assert one -- only
 * `record_citation_verification()` sets that column, and it demands a named platform admin, a date
 * and a source URL.
 */
export type GovernedCitationStatus = "verified" | "unverified" | "approximate" | "superseded";

export type CitationModule =
  | "resident_assessment"
  | "support_plan"
  | "medical_evaluation"
  | "admission";

export interface PaRegulatoryCitation {
  /** Section number as PA writes it, e.g. "2600.225". */
  citation: string;
  chapter: "2600" | "2800";
  /** Stored facility-type codes this section governs. */
  facilityTypes: FacilityType[];
  heading: string;
  /** What the section requires, in the words the source data used. */
  requirement: string;
  responsibleRole: string;
  requiredFrequency: string;
  /** The document that proves compliance -- always the DHS-prescribed form, never an in-app record. */
  requiredEvidence: string;
  modules: CitationModule[];
  sourceUrl: string;
  sourceLabel: string;
  /**
   * Which shipped, reviewed artifact this entry's wording was carried forward from.
   *
   * Deliberately NOT a verification status. This library used to carry `verification.status`, and
   * every one of its entries said `"verified"` -- while `dhs_citation_topics.verification_status`,
   * the governed column that only `record_citation_verification()` can set, said `approximate` or
   * `unverified` for the same citations and still does. Two systems answering the same question
   * differently, with the informal one always answering yes (BACKLOG.md F10). Provenance is what
   * this module actually knows; verification is the database's to state.
   */
  provenance: {
    note: string;
  };
}

const PA_CODE_2600 = "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2600/chap2600toc.html";
const PA_CODE_2800 = "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2800/chap2800toc.html";

export const PA_REGULATORY_CITATIONS: PaRegulatoryCitation[] = [
  {
    citation: "2600.224",
    chapter: "2600",
    facilityTypes: ["PCH"],
    heading: "Preadmission screening",
    requirement:
      "A preadmission screening must be completed within the 30 days prior to admission. Due by admission with no grace period.",
    responsibleRole: "Administrator",
    requiredFrequency: "Once, before admission",
    requiredEvidence: "Signed DHS Preadmission Screening form attached to the resident record.",
    modules: ["admission", "resident_assessment"],
    sourceUrl: PA_CODE_2600,
    sourceLabel: "55 Pa. Code Chapter 2600 (Personal Care Homes)",
    provenance: {
      note: "Carried forward from dhs_citation_topics (20260706143020): \"Verified: 55 Pa Code 2600.224, preadmission screening within 30 days prior to admission, zero grace period.\"",
    },
  },
  {
    citation: "2600.225",
    chapter: "2600",
    facilityTypes: ["PCH"],
    heading: "Initial and annual assessment",
    requirement:
      "An initial assessment is due within 15 days after admission. Reassessment is due annually, with a 15-day grace period on the annual cycle, and again upon a significant change in condition.",
    responsibleRole: "Administrator",
    requiredFrequency: "Within 15 days of admission, then annually and on significant change",
    requiredEvidence: "Signed DHS RASP (Resident Assessment-Support Plan) form attached to the resident record.",
    modules: ["resident_assessment"],
    sourceUrl: PA_CODE_2600,
    sourceLabel: "55 Pa. Code Chapter 2600 (Personal Care Homes)",
    provenance: {
      note: "Carried forward from resident_compliance_rule_packs (20260706155617): initial_assessment_15day \"Zero grace, confirmed\"; annual_reassessment \"15-day grace confirmed via the 2600 RCG's general Grace Periods table (12 months + 15 days).\"",
    },
  },
  {
    citation: "2600.227",
    chapter: "2600",
    facilityTypes: ["PCH"],
    heading: "Development of the support plan",
    requirement:
      "A support plan is due within 30 days of admission, and must be revised within 30 days of completing the annual assessment or upon a significant-change reassessment.",
    responsibleRole: "Administrator",
    requiredFrequency: "Within 30 days of admission, then on each annual or significant-change assessment",
    requiredEvidence: "Signed DHS RASP support-plan section attached to the resident record.",
    modules: ["support_plan"],
    sourceUrl: PA_CODE_2600,
    sourceLabel: "55 Pa. Code Chapter 2600 (Personal Care Homes)",
    provenance: {
      note: "Carried forward from dhs_citation_topics (20260706143020): \"Verified: 55 Pa Code 2600.227, support plan within 30 days of admission; revised within 30 days of completing the annual assessment or upon a significant-change reassessment.\"",
    },
  },
  {
    citation: "2600.141",
    chapter: "2600",
    facilityTypes: ["PCH"],
    heading: "Resident medical evaluation",
    requirement:
      "A medical evaluation is required on a 60-days-before / 30-days-after admission window, then annually, with a 15-day grace period on the annual cycle.",
    responsibleRole: "Administrator",
    requiredFrequency: "At admission, then annually",
    requiredEvidence: "Signed DHS DME (Documentation of Medical Evaluation) form attached to the resident record.",
    modules: ["medical_evaluation"],
    sourceUrl: PA_CODE_2600,
    sourceLabel: "55 Pa. Code Chapter 2600 (Personal Care Homes)",
    provenance: {
      note: "PA DHS's own 2600 Regulatory Compliance Guide confirms the annual-cycle grace period at 15 days: p.5's Grace Periods table names \"Medical evaluations (§ 2600.141)\" in the 15-day list, and p.118 restates it directly under § 2600.141(b)(1). The same page's exclusion list names only § 2600.141(a) (the initial evaluation), confirming the grace applies to the annual cycle and not the initial admission window. Applied by 20260804170000, which split the shared row into `medical_evaluation` (the initial evaluation, grace 0) and `annual_medical_evaluation` (grace 15). 20260804000000 had confirmed the figure but could not apply it, because one rule-pack row covered both cycles and the initial one is named in the exclusion list.",
    },
  },
  {
    citation: "2800.224",
    chapter: "2800",
    facilityTypes: ["ALR"],
    heading: "Initial assessment and preliminary support plan",
    requirement:
      "The initial assessment and the preliminary support plan are due together, 30 days before admission on the standard track. On the expedited track they are due within 15 days after admission.",
    responsibleRole: "Administrator",
    requiredFrequency: "Before admission (standard) or within 15 days after admission (expedited)",
    requiredEvidence: "Signed DHS ASP (Assessment-Support Plan) form attached to the resident record.",
    modules: ["admission", "resident_assessment", "support_plan"],
    sourceUrl: PA_CODE_2800,
    sourceLabel: "55 Pa. Code Chapter 2800 (Assisted Living Facilities)",
    provenance: {
      note: "Carried forward from dhs_citation_topics and resident_compliance_rule_packs (20260706155617): \"Verified: 55 Pa Code 2800.224 covers both the initial assessment and preliminary support plan together\"; ALR standard track is 30 days before admission, not after.",
    },
  },
  {
    citation: "2800.225",
    chapter: "2800",
    facilityTypes: ["ALR"],
    heading: "Annual and significant-change reassessment",
    requirement:
      "Reassessment is due annually and upon a significant change in condition, with a 15-day grace period on the annual cycle.",
    responsibleRole: "Administrator",
    requiredFrequency: "Annually and on significant change",
    requiredEvidence: "Signed DHS ASP (Assessment-Support Plan) form attached to the resident record.",
    modules: ["resident_assessment", "support_plan"],
    sourceUrl: PA_CODE_2800,
    sourceLabel: "55 Pa. Code Chapter 2800 (Assisted Living Facilities)",
    provenance: {
      note: "resident_compliance_rule_packs (20260804000000) confirms the annual-cycle grace period at 15 days via PA DHS's 2800 Regulatory Compliance Guide, p.5 Grace Periods table, which names \"Completion of ANNUAL Resident Assessments (2800.225(a)(1))\" directly in the 15-day list -- the same evidentiary standard already accepted for 2600.225 and 2800.141 in this file. The same page's exclusion list names only 2800.225(a) (the initial assessment), confirming the grace applies to the annual/significant-change cycle rather than the initial one.",
    },
  },
  {
    citation: "2800.141",
    chapter: "2800",
    facilityTypes: ["ALR"],
    heading: "Resident medical evaluation",
    requirement:
      "A medical evaluation is required at admission and annually thereafter, with a 15-day grace period on the annual cycle.",
    responsibleRole: "Administrator",
    requiredFrequency: "At admission, then annually",
    requiredEvidence: "Signed DHS DME (Documentation of Medical Evaluation) form attached to the resident record.",
    modules: ["medical_evaluation"],
    sourceUrl: PA_CODE_2800,
    sourceLabel: "55 Pa. Code Chapter 2800 (Assisted Living Facilities)",
    provenance: {
      note: "Carried forward from dhs_citation_topics (20260706155617): \"Verified: 55 Pa Code 2800.141/2800.22(a)(1). 15-day annual grace confirmed via the 2800 RCG.\"",
    },
  },
];

/**
 * Compliance item types (`resident_compliance_items.item_type`) to the section that governs them,
 * per facility type. Mirrors the rule-pack mapping rather than re-deriving it: for ALR, the support
 * plan is governed by 2800.224 alongside the initial assessment, NOT by a separate section.
 */
const ITEM_TYPE_CITATIONS: Record<string, Partial<Record<FacilityType, string>>> = {
  preadmission_screening: { PCH: "2600.224", ALR: "2800.224" },
  initial_assessment_15day: { PCH: "2600.225", ALR: "2800.224" },
  support_plan_30day: { PCH: "2600.227", ALR: "2800.224" },
  annual_reassessment: { PCH: "2600.225", ALR: "2800.225" },
  significant_change_reassessment: { PCH: "2600.225", ALR: "2800.225" },
  medical_evaluation: { PCH: "2600.141", ALR: "2800.141" },
  // Same section as the initial evaluation -- 20260804170000 split the two cycles into separate
  // item types so each could carry its own grace period, not because they are different rules.
  annual_medical_evaluation: { PCH: "2600.141", ALR: "2800.141" },
};

export function findCitation(citation: string): PaRegulatoryCitation | undefined {
  return PA_REGULATORY_CITATIONS.find((entry) => entry.citation === citation);
}

/**
 * The governing section for a compliance item. Returns undefined rather than a best guess for an
 * unmapped item type or a facility type with no rule pack -- a wrong citation is worse than none.
 */
export function citationForComplianceItem(
  itemType: string,
  facilityType: string | null | undefined,
): PaRegulatoryCitation | undefined {
  if (facilityType !== "PCH" && facilityType !== "ALR") return undefined;
  const citation = ITEM_TYPE_CITATIONS[itemType]?.[facilityType];
  return citation ? findCitation(citation) : undefined;
}

export function citationsForModule(
  module: CitationModule,
  facilityType?: string | null,
): PaRegulatoryCitation[] {
  return PA_REGULATORY_CITATIONS.filter((entry) => {
    if (!entry.modules.includes(module)) return false;
    if (facilityType !== "PCH" && facilityType !== "ALR") return true;
    return entry.facilityTypes.includes(facilityType);
  });
}

export function citationLibraryAgeInDays(now: Date = new Date()): number {
  const verified = new Date(`${PA_CITATIONS_LAST_VERIFIED}T00:00:00Z`);
  return Math.floor((now.getTime() - verified.getTime()) / 86_400_000);
}

export function isCitationLibraryStale(now: Date = new Date()): boolean {
  return citationLibraryAgeInDays(now) > CITATION_REVIEW_MAX_AGE_DAYS;
}

/**
 * How a governed status reads next to a citation, or null when there is nothing to add.
 *
 * `verified` adds nothing: a verified citation should read as a plain citation, and a badge saying
 * so would make the absence of one on every other entry easy to miss.
 */
export function governedStatusSuffix(status: GovernedCitationStatus | null | undefined): string | null {
  switch (status) {
    case "verified": return null;
    case "approximate": return "approximate — not verified against the source";
    case "superseded": return "superseded";
    // Both an explicit `unverified` and a citation with no governed row at all. The distinction
    // matters to whoever fixes it, not to the person reading a form.
    default: return "not verified";
  }
}

/**
 * One-line attribution for rendering next to a field.
 *
 * The status comes from `dhs_citation_topics.verification_status` and is passed in, because this
 * module does not know it and must not guess. Called without one, the label says "not verified" --
 * which is the truthful default: a citation nobody has run `record_citation_verification()` for is
 * not verified, and every entry in this library is currently in that position.
 */
export function citationDisplayLabel(
  entry: PaRegulatoryCitation,
  governedStatus?: GovernedCitationStatus | null,
): string {
  const suffix = governedStatusSuffix(governedStatus);
  return `55 Pa. Code § ${entry.citation} — ${entry.heading}${suffix ? ` (${suffix})` : ""}`;
}

/** Index governed statuses by citation ref, for callers holding a `dhs_citation_topics` list. */
export function governedStatusByCitation(
  topics: { citation_ref: string | null; verification_status: string }[],
): Record<string, GovernedCitationStatus> {
  const byRef: Record<string, GovernedCitationStatus> = {};
  for (const topic of topics) {
    if (!topic.citation_ref) continue;
    // A topic row can name several sections at once ("2600.65 / 2800.65"), and each of them carries
    // that row's status.
    for (const ref of topic.citation_ref.split("/").map((part) => part.trim())) {
      if (ref) byRef[ref] = topic.verification_status as GovernedCitationStatus;
    }
  }
  return byRef;
}

// `scripts/check-dhs-sources.mjs` covers the pacodeandbulletin.gov URLs above -- and the
// PA_CITATIONS_LAST_VERIFIED staleness gate -- the same way it already covers the pa.gov form
// links, so a moved or dead regulation link fails CI instead of waiting for the next human review.
