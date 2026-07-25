import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_STAGES,
  countByStage,
  overdueFollowUps,
  PIPELINE_STAGES,
  pipelineStage,
  pipelineStageLabel,
  referralSourcePerformance,
  SETTABLE_STAGES,
  stageDirection,
  weightedPipelineValue,
  type ProspectLike,
} from "./admissionPipeline";

const MIGRATION = join(
  __dirname, "..", "..", "..", "..",
  "supabase/migrations/20260726170000_admissions_pipeline_stages.sql",
);

function prospect(id: string, overrides: Partial<ProspectLike> = {}): ProspectLike {
  return {
    id,
    pipeline_stage: "new_inquiry",
    referral_source_name: "Hospital discharge",
    expected_monthly_revenue: null,
    probability_percent: null,
    next_follow_up_at: null,
    inquiry_date: "2026-07-01",
    ...overrides,
  };
}

describe("the stage list", () => {
  it("has the fourteen stages the request names", () => {
    expect(PIPELINE_STAGES).toHaveLength(14);
  });

  it("matches the check constraint in the migration", () => {
    // The server rejects anything outside its list, so a client list that has drifted offers
    // stages that cannot be saved.
    const sql = readFileSync(MIGRATION, "utf8");
    const start = sql.indexOf("check (pipeline_stage in (");
    expect(start, "constraint not found").toBeGreaterThan(-1);
    const block = sql.slice(start, sql.indexOf("));", start));
    const constrained = [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect([...constrained].sort()).toEqual(PIPELINE_STAGES.map((entry) => entry.key).sort());
  });

  it("orders the funnel without gaps, and puts loss outside it", () => {
    const ordered = PIPELINE_STAGES.filter((entry) => entry.order !== null);
    expect(ordered.map((entry) => entry.order)).toEqual(ordered.map((_, index) => index));
    expect(pipelineStage("lost_declined")?.order).toBeNull();
  });

  it("explains what each stage actually means", () => {
    for (const entry of PIPELINE_STAGES) {
      expect(entry.meaning.length, entry.key).toBeGreaterThan(20);
    }
  });

  it("treats admitted and lost as terminal and nothing else", () => {
    expect(PIPELINE_STAGES.filter((entry) => entry.terminal).map((entry) => entry.key))
      .toEqual(["admitted", "lost_declined"]);
    expect(ACTIVE_STAGES).toHaveLength(12);
  });

  it("does not offer admitted as a stage a person can set", () => {
    // The move-in workflow sets it, because it is what creates the resident record. A board that
    // could set it would produce an admitted prospect with nobody living anywhere.
    expect(SETTABLE_STAGES.map((entry) => entry.key)).not.toContain("admitted");
    expect(SETTABLE_STAGES).toHaveLength(13);
  });

  it("labels an unknown stage rather than rendering nothing", () => {
    expect(pipelineStageLabel("some_new_stage")).toBe("Some new stage");
  });
});

describe("direction of travel", () => {
  it("recognizes forward and backward moves", () => {
    expect(stageDirection("qualified", "tour_scheduled")).toBe("forward");
    // Tours get cancelled. A funnel that refuses to record that gets worked around in a
    // spreadsheet, so this reports the regression rather than rejecting it.
    expect(stageDirection("tour_completed", "qualified")).toBe("backward");
  });

  it("recognizes leaving and re-entering the funnel", () => {
    expect(stageDirection("tour_completed", "lost_declined")).toBe("exited");
    expect(stageDirection("lost_declined", "qualified")).toBe("reentered");
  });

  it("reports no movement for the same stage or an unknown one", () => {
    expect(stageDirection("qualified", "qualified")).toBe("same");
    expect(stageDirection("qualified", "not_a_stage")).toBe("same");
  });
});

describe("counting", () => {
  it("keeps empty stages so the shape of the funnel is visible", () => {
    // A funnel that hides its empty stages hides exactly where prospects stop arriving.
    const counts = countByStage([prospect("a", { pipeline_stage: "tour_completed" })]);
    expect(counts).toHaveLength(14);
    expect(counts.find((entry) => entry.key === "tour_completed")?.count).toBe(1);
    expect(counts.find((entry) => entry.key === "qualified")?.count).toBe(0);
  });

  it("carries the prospect ids behind each count", () => {
    const counts = countByStage([
      prospect("a", { pipeline_stage: "qualified" }),
      prospect("b", { pipeline_stage: "qualified" }),
    ]);
    expect(counts.find((entry) => entry.key === "qualified")?.prospectIds.sort()).toEqual(["a", "b"]);
  });
});

describe("referral source performance", () => {
  it("divides conversion by concluded inquiries, not by everything", () => {
    // Dividing by all inquiries counts somebody who enquired yesterday as a failure, which makes a
    // source look worse the more recent business it brings in.
    const performance = referralSourcePerformance([
      prospect("a", { pipeline_stage: "admitted" }),
      prospect("b", { pipeline_stage: "lost_declined" }),
      prospect("c", { pipeline_stage: "tour_scheduled" }),
    ]);
    expect(performance[0].conversionRate).toBe(50);
    expect(performance[0].inquiries).toBe(3);
  });

  it("reports nothing rather than zero when nothing has concluded", () => {
    const performance = referralSourcePerformance([prospect("a", { pipeline_stage: "tour_scheduled" })]);
    expect(performance[0].conversionRate).toBeNull();
  });

  it("groups prospects with no referral source under a named bucket", () => {
    const performance = referralSourcePerformance([prospect("a", { referral_source_name: null })]);
    expect(performance[0].source).toBe("Direct inquiry");
  });

  it("forecasts revenue only from prospects still in play", () => {
    const performance = referralSourcePerformance([
      prospect("a", { pipeline_stage: "tour_scheduled", expected_monthly_revenue: 5000 }),
      prospect("b", { pipeline_stage: "admitted", expected_monthly_revenue: 6000 }),
      prospect("c", { pipeline_stage: "lost_declined", expected_monthly_revenue: 7000 }),
    ]);
    expect(performance[0].expectedMonthlyRevenue).toBe(5000);
  });

  it("orders by volume, then by name for a stable list", () => {
    const performance = referralSourcePerformance([
      prospect("a", { referral_source_name: "Small" }),
      prospect("b", { referral_source_name: "Big" }),
      prospect("c", { referral_source_name: "Big" }),
    ]);
    expect(performance.map((entry) => entry.source)).toEqual(["Big", "Small"]);
  });
});

describe("follow-ups", () => {
  const now = new Date("2026-07-25T12:00:00Z");

  it("lists an overdue follow-up on a live prospect", () => {
    expect(overdueFollowUps([
      prospect("a", { next_follow_up_at: "2026-07-20T12:00:00Z" }),
    ], now).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("ignores one that is not yet due", () => {
    expect(overdueFollowUps([
      prospect("a", { next_follow_up_at: "2026-07-30T12:00:00Z" }),
    ], now)).toEqual([]);
  });

  it("ignores a prospect who has already been admitted or lost", () => {
    expect(overdueFollowUps([
      prospect("a", { pipeline_stage: "admitted", next_follow_up_at: "2026-07-20T12:00:00Z" }),
      prospect("b", { pipeline_stage: "lost_declined", next_follow_up_at: "2026-07-20T12:00:00Z" }),
    ], now)).toEqual([]);
  });

  it("ignores a prospect with no follow-up date rather than treating it as overdue", () => {
    expect(overdueFollowUps([prospect("a")], now)).toEqual([]);
  });
});

describe("weighted pipeline value", () => {
  it("weights each prospect by its own stated probability", () => {
    const value = weightedPipelineValue([
      prospect("a", { pipeline_stage: "accepted", expected_monthly_revenue: 6000, probability_percent: 50 }),
      prospect("b", { pipeline_stage: "qualified", expected_monthly_revenue: 4000, probability_percent: 25 }),
    ]);
    expect(value.weighted).toBe(4000);
    expect(value.unweighted).toBe(10000);
  });

  it("contributes nothing for a prospect with no probability, and says how much that was", () => {
    // An invented default is how a forecast becomes fiction nobody can trace back.
    const value = weightedPipelineValue([
      prospect("a", { expected_monthly_revenue: 5000, probability_percent: null }),
    ]);
    expect(value.weighted).toBe(0);
    expect(value.withoutProbability).toBe(5000);
  });

  it("excludes admitted and lost prospects from the forecast", () => {
    const value = weightedPipelineValue([
      prospect("a", { pipeline_stage: "admitted", expected_monthly_revenue: 9000, probability_percent: 100 }),
      prospect("b", { pipeline_stage: "lost_declined", expected_monthly_revenue: 9000, probability_percent: 100 }),
    ]);
    expect(value).toEqual({ weighted: 0, unweighted: 0, withoutProbability: 0 });
  });

  it("returns zeroes for an empty pipeline", () => {
    expect(weightedPipelineValue([])).toEqual({ weighted: 0, unweighted: 0, withoutProbability: 0 });
  });
});
