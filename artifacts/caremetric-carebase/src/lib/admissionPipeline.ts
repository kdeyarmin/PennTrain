/**
 * The admissions funnel (program plan Phase 9a, request item 20).
 *
 * TWO COLUMNS, TWO QUESTIONS. `admission_prospects.stage` is a *decision lifecycle*: it gates bed
 * reservation and move-in, and `reserve_bed_for_prospect` refuses unless clinical and financial
 * review are both approved. `pipeline_stage` is the *sales funnel* this module models. "Tour
 * scheduled" says nothing about whether anybody has been clinically approved, which is why the
 * fourteen stages the request lists could not simply widen the existing column.
 *
 * FORWARD IS NOT ENFORCED, AND THAT IS DELIBERATE. Tours get cancelled and families go quiet. A
 * funnel that refuses to record a step backwards gets worked around in a spreadsheet, and then the
 * pipeline in the product is fiction. `stageDirection` exists so a surface can *show* a regression
 * without refusing it.
 */

export type PipelineStage =
  | "new_inquiry"
  | "contact_attempted"
  | "qualified"
  | "tour_scheduled"
  | "tour_completed"
  | "assessment_scheduled"
  | "assessment_completed"
  | "financial_review"
  | "accepted"
  | "deposit_pending"
  | "move_in_scheduled"
  | "move_in_ready"
  | "admitted"
  | "lost_declined";

export interface PipelineStageDefinition {
  key: PipelineStage;
  label: string;
  /** What has actually happened by the time a prospect sits here. */
  meaning: string;
  /** Order in the funnel. `lost_declined` sits outside it. */
  order: number | null;
  /** True when the prospect has left the funnel, in either direction. */
  terminal: boolean;
}

/** Mirrors the check constraint in 20260726170000_admissions_pipeline_stages.sql. */
export const PIPELINE_STAGES: PipelineStageDefinition[] = [
  { key: "new_inquiry", label: "New inquiry", order: 0, terminal: false,
    meaning: "Somebody made contact. Nothing has been established beyond that." },
  { key: "contact_attempted", label: "Contact attempted", order: 1, terminal: false,
    meaning: "The facility has tried to reach them and has not yet spoken to them." },
  { key: "qualified", label: "Qualified", order: 2, terminal: false,
    meaning: "A conversation established the facility could plausibly meet their needs." },
  { key: "tour_scheduled", label: "Tour scheduled", order: 3, terminal: false,
    meaning: "A visit is booked, with a date the family has agreed to." },
  { key: "tour_completed", label: "Tour completed", order: 4, terminal: false,
    meaning: "The visit happened. Whether it went well is the next conversation." },
  { key: "assessment_scheduled", label: "Assessment scheduled", order: 5, terminal: false,
    meaning: "A pre-admission assessment is booked with an assessor." },
  { key: "assessment_completed", label: "Assessment completed", order: 6, terminal: false,
    meaning: "The assessment is done. Whether it was approved is the decision lifecycle's question." },
  { key: "financial_review", label: "Financial review", order: 7, terminal: false,
    meaning: "Affordability and funding are being worked through." },
  { key: "accepted", label: "Accepted", order: 8, terminal: false,
    meaning: "The facility has said yes, on clinical and financial grounds both." },
  { key: "deposit_pending", label: "Deposit pending", order: 9, terminal: false,
    meaning: "A bed is held and the deposit has not arrived." },
  { key: "move_in_scheduled", label: "Move-in scheduled", order: 10, terminal: false,
    meaning: "A move-in date is agreed, though the room may not be ready yet." },
  { key: "move_in_ready", label: "Move-in ready", order: 11, terminal: false,
    meaning: "Every move-in task is done and the room is ready." },
  { key: "admitted", label: "Admitted", order: 12, terminal: true,
    meaning: "They live here. Set by the move-in workflow, which creates the resident record." },
  { key: "lost_declined", label: "Lost or declined", order: null, terminal: true,
    meaning: "They went elsewhere, or the facility could not accept them." },
];

const BY_KEY = new Map(PIPELINE_STAGES.map((entry) => [entry.key, entry]));

export function pipelineStage(key: string): PipelineStageDefinition | undefined {
  return BY_KEY.get(key as PipelineStage);
}

export function pipelineStageLabel(key: string): string {
  return BY_KEY.get(key as PipelineStage)?.label
    ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Stages a person can move a prospect to. `admitted` is not one: the move-in workflow sets it. */
export const SETTABLE_STAGES = PIPELINE_STAGES.filter((entry) => entry.key !== "admitted");

/** Stages still in play, for the "active pipeline" view. */
export const ACTIVE_STAGES = PIPELINE_STAGES.filter((entry) => !entry.terminal);

export type StageDirection = "forward" | "backward" | "same" | "exited" | "reentered";

/**
 * How a move relates to the funnel, so a surface can show a regression rather than refuse it.
 */
export function stageDirection(from: string, to: string): StageDirection {
  const a = pipelineStage(from);
  const b = pipelineStage(to);
  if (!a || !b) return "same";
  if (a.key === b.key) return "same";
  if (b.key === "lost_declined") return "exited";
  if (a.key === "lost_declined") return "reentered";
  if (a.order === null || b.order === null) return "same";
  return b.order > a.order ? "forward" : "backward";
}

export interface ProspectLike {
  id: string;
  pipeline_stage: string;
  referral_source_name: string | null;
  expected_monthly_revenue: number | null;
  probability_percent: number | null;
  next_follow_up_at: string | null;
  inquiry_date: string;
}

export interface StageCount {
  key: PipelineStage;
  label: string;
  count: number;
  prospectIds: string[];
}

/** Counts per stage, in funnel order, including empty stages so the shape of the funnel is visible. */
export function countByStage(prospects: ProspectLike[]): StageCount[] {
  return PIPELINE_STAGES.map((definition) => {
    const matching = prospects.filter((prospect) => prospect.pipeline_stage === definition.key);
    return {
      key: definition.key,
      label: definition.label,
      count: matching.length,
      prospectIds: matching.map((prospect) => prospect.id),
    };
  });
}

export interface ReferralSourcePerformance {
  source: string;
  inquiries: number;
  admitted: number;
  lost: number;
  /** Admitted as a percentage of *concluded* inquiries — see the note below. */
  conversionRate: number | null;
  expectedMonthlyRevenue: number;
}

/**
 * Referral source performance.
 *
 * The conversion rate divides by CONCLUDED inquiries, not all of them. Dividing by everything counts
 * a prospect who enquired yesterday as a failure, which makes every source look worse the more
 * recent business it brings in — the opposite of what the number is for. A source with nothing
 * concluded yet reports null rather than zero.
 */
export function referralSourcePerformance(prospects: ProspectLike[]): ReferralSourcePerformance[] {
  const bySource = new Map<string, ProspectLike[]>();
  for (const prospect of prospects) {
    const key = prospect.referral_source_name ?? "Direct inquiry";
    const existing = bySource.get(key);
    if (existing) existing.push(prospect);
    else bySource.set(key, [prospect]);
  }

  return [...bySource.entries()]
    .map(([source, entries]) => {
      const admitted = entries.filter((entry) => entry.pipeline_stage === "admitted").length;
      const lost = entries.filter((entry) => entry.pipeline_stage === "lost_declined").length;
      const concluded = admitted + lost;
      return {
        source,
        inquiries: entries.length,
        admitted,
        lost,
        conversionRate: concluded === 0 ? null : Math.round((admitted / concluded) * 100),
        // Only what is still in play: revenue from an admitted or lost prospect is not a forecast.
        expectedMonthlyRevenue: entries
          .filter((entry) => !pipelineStage(entry.pipeline_stage)?.terminal)
          .reduce((sum, entry) => sum + (entry.expected_monthly_revenue ?? 0), 0),
      };
    })
    .sort((a, b) => b.inquiries - a.inquiries || a.source.localeCompare(b.source));
}

/** Prospects whose follow-up date has passed and who are still in play. */
export function overdueFollowUps(prospects: ProspectLike[], now = new Date()): ProspectLike[] {
  return prospects.filter((prospect) => {
    if (pipelineStage(prospect.pipeline_stage)?.terminal) return false;
    if (!prospect.next_follow_up_at) return false;
    const due = Date.parse(prospect.next_follow_up_at);
    return Number.isFinite(due) && due < now.getTime();
  });
}

/**
 * Expected monthly revenue weighted by each prospect's stated probability.
 *
 * A prospect with no probability recorded contributes nothing rather than a guessed number: an
 * invented default is how a forecast becomes fiction that nobody can trace. `withoutProbability`
 * reports how much revenue is sitting outside the forecast for exactly that reason.
 */
export function weightedPipelineValue(prospects: ProspectLike[]): {
  weighted: number;
  unweighted: number;
  withoutProbability: number;
} {
  const live = prospects.filter((prospect) => !pipelineStage(prospect.pipeline_stage)?.terminal);
  let weighted = 0;
  let unweighted = 0;
  let withoutProbability = 0;
  for (const prospect of live) {
    const revenue = prospect.expected_monthly_revenue ?? 0;
    unweighted += revenue;
    if (prospect.probability_percent === null) withoutProbability += revenue;
    else weighted += (revenue * prospect.probability_percent) / 100;
  }
  return {
    weighted: Math.round(weighted),
    unweighted: Math.round(unweighted),
    withoutProbability: Math.round(withoutProbability),
  };
}
