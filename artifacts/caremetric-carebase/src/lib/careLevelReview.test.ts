import { describe, expect, it } from "vitest";
import {
  buildCareLevelReview,
  careLevelStatusBadgeClass,
  careLevelStatusLabel,
  careLevelWorklist,
  computeResidentCareLevelReview,
  currentRatesByResident,
  latestAssessmentByResident,
  summarizeCareLevelReview,
  type RateAgreementLike,
  type ResidentLike,
} from "./careLevelReview";

const TODAY = new Date(2026, 6, 24); // 2026-07-24
const resident = (id: string, last = "Doe", first = "Jane"): ResidentLike => ({ id, last_name: last, first_name: first, room: "101" });
const rate = (resident_id: string, over: Partial<RateAgreementLike> = {}): RateAgreementLike => ({
  resident_id, level_of_care_charge: 500, effective_from: "2026-07-01", version_number: 1, ...over,
});

describe("currentRatesByResident", () => {
  it("keeps the highest-version in-force rate per resident", () => {
    const map = currentRatesByResident([
      rate("a", { version_number: 1, level_of_care_charge: 100 }),
      rate("a", { version_number: 3, level_of_care_charge: 300 }),
      rate("a", { version_number: 2, level_of_care_charge: 200 }),
      rate("b", { version_number: 1, level_of_care_charge: 50 }),
    ], TODAY);
    expect(map.get("a")?.level_of_care_charge).toBe(300);
    expect(map.get("b")?.level_of_care_charge).toBe(50);
  });

  it("ignores a future-dated amendment and an expired rate", () => {
    const map = currentRatesByResident([
      rate("a", { version_number: 1, level_of_care_charge: 100, effective_from: "2026-01-01" }),
      rate("a", { version_number: 2, level_of_care_charge: 500, effective_from: "2026-12-01" }), // future
      rate("b", { version_number: 1, level_of_care_charge: 80, effective_from: "2025-01-01", effective_through: "2025-12-31" }), // expired
    ], TODAY);
    expect(map.get("a")?.level_of_care_charge).toBe(100); // the not-yet-effective v2 is ignored
    expect(map.has("b")).toBe(false); // an expired rate is not in force today
  });
});

describe("latestAssessmentByResident", () => {
  it("takes the most recent date across sources and ignores null dates", () => {
    const clinical = [{ resident_id: "a", at: "2026-01-10T12:00:00Z" }, { resident_id: "a", at: null }];
    const forms = [{ resident_id: "a", at: "2026-06-01T12:00:00Z" }, { resident_id: "b", at: "2026-03-03T12:00:00Z" }];
    const map = latestAssessmentByResident(clinical, forms);
    expect(map.get("a")).toBe("2026-06-01T12:00:00Z");
    expect(map.get("b")).toBe("2026-03-03T12:00:00Z");
  });
});

describe("computeResidentCareLevelReview", () => {
  it("is current when rate is newer than a recent assessment and a charge is set", () => {
    const row = computeResidentCareLevelReview(resident("a"), rate("a", { effective_from: "2026-07-01" }), "2026-06-15T12:00:00Z", TODAY);
    expect(row.status).toBe("ok");
    expect(row.flags).toHaveLength(0);
  });

  it("flags a missing rate agreement as action-needed", () => {
    const row = computeResidentCareLevelReview(resident("a"), null, "2026-06-15T12:00:00Z", TODAY);
    expect(row.status).toBe("high");
    expect(row.flags.map((f) => f.kind)).toContain("no_rate_agreement");
    expect(row.levelOfCareCharge).toBeNull();
  });

  it("flags a missing assessment as action-needed", () => {
    const row = computeResidentCareLevelReview(resident("a"), rate("a"), null, TODAY);
    expect(row.status).toBe("high");
    expect(row.flags.map((f) => f.kind)).toContain("no_assessment_on_file");
  });

  it("flags an assessment recorded after the current rate", () => {
    const row = computeResidentCareLevelReview(resident("a"), rate("a", { effective_from: "2026-01-01" }), "2026-06-01T12:00:00Z", TODAY);
    expect(row.status).toBe("attention");
    expect(row.flags.map((f) => f.kind)).toContain("reassessed_since_rate");
  });

  it("flags a stale assessment overdue for annual reassessment", () => {
    const row = computeResidentCareLevelReview(resident("a"), rate("a", { effective_from: "2023-01-01" }), "2024-01-01T12:00:00Z", TODAY);
    expect(row.flags.map((f) => f.kind)).toContain("stale_assessment");
    expect(row.daysSinceAssessed!).toBeGreaterThan(900);
  });

  it("flags a $0 level-of-care charge for verification", () => {
    const row = computeResidentCareLevelReview(resident("a"), rate("a", { effective_from: "2026-07-01", level_of_care_charge: 0 }), "2026-06-15T12:00:00Z", TODAY);
    expect(row.status).toBe("info");
    expect(row.flags.map((f) => f.kind)).toContain("zero_care_charge");
  });

  it("takes the worst severity when several flags apply", () => {
    // No rate (high) + no assessment (high) → high overall.
    const row = computeResidentCareLevelReview(resident("a"), null, null, TODAY);
    expect(row.status).toBe("high");
    expect(row.flags).toHaveLength(2);
  });
});

describe("buildCareLevelReview + worklist + summary", () => {
  const residents = [resident("a", "Adams"), resident("b", "Baker"), resident("c", "Clark")];
  const rates = [rate("a", { effective_from: "2026-07-01" }), rate("c", { effective_from: "2026-01-01" })];
  const clinical = [{ resident_id: "a", at: "2026-06-15T12:00:00Z" }, { resident_id: "c", at: "2026-06-01T12:00:00Z" }];
  const forms = [{ resident_id: "b", at: null }];

  it("joins rate + assessment and scores each resident", () => {
    const rows = buildCareLevelReview(residents, rates, [clinical, forms], TODAY);
    const byId = new Map(rows.map((r) => [r.residentId, r]));
    expect(byId.get("a")?.status).toBe("ok"); // rate newer than assessment, charge set
    expect(byId.get("b")?.status).toBe("high"); // no rate + no assessment
    expect(byId.get("c")?.status).toBe("attention"); // assessed after the Jan rate
  });

  it("worklist drops the current residents and sorts worst-first", () => {
    const rows = buildCareLevelReview(residents, rates, [clinical, forms], TODAY);
    const worklist = careLevelWorklist(rows);
    expect(worklist.map((r) => r.residentId)).toEqual(["b", "c"]); // high before attention; "a" (ok) excluded
  });

  it("summarizes counts by status", () => {
    const summary = summarizeCareLevelReview(buildCareLevelReview(residents, rates, [clinical, forms], TODAY));
    expect(summary).toMatchObject({ total: 3, needsReview: 2, high: 1, attention: 1, ok: 1 });
  });
});

describe("status metadata", () => {
  it("labels and colors each status", () => {
    expect(careLevelStatusLabel("high")).toBe("Action needed");
    expect(careLevelStatusLabel("attention")).toBe("Review due");
    expect(careLevelStatusLabel("ok")).toBe("Current");
    expect(careLevelStatusBadgeClass("high")).toContain("bg-destructive");
    expect(careLevelStatusBadgeClass("ok")).toContain("bg-success");
  });
});
