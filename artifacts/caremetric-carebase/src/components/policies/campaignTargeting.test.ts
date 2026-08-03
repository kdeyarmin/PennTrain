import { describe, expect, it } from "vitest";
import {
  MANUAL_TARGETING,
  targetingIsValid,
  toJobTitlePattern,
} from "@/components/policies/CampaignTargetingEditor";

describe("toJobTitlePattern", () => {
  // The column holds a raw ILIKE pattern (the convention compliance_profile_mapping_rules already
  // uses). Storing what the administrator typed verbatim would match only that exact title, which
  // silently contradicts the field's own "matches anywhere" help text -- a campaign that looks
  // correctly configured and quietly enrols nobody.
  it("wraps plain text so it matches anywhere in the title", () => {
    expect(toJobTitlePattern("Direct Care Aide")).toBe("%Direct Care Aide%");
  });

  it("leaves an explicit pattern alone rather than double-wrapping it", () => {
    expect(toJobTitlePattern("Aide%")).toBe("Aide%");
    expect(toJobTitlePattern("%Aide%")).toBe("%Aide%");
  });

  it("trims, because a stray space would become part of the pattern", () => {
    expect(toJobTitlePattern("  Cook  ")).toBe("%Cook%");
  });

  it("treats blank input as no constraint, not as a pattern matching nothing", () => {
    expect(toJobTitlePattern("")).toBeNull();
    expect(toJobTitlePattern("   ")).toBeNull();
    expect(toJobTitlePattern(null)).toBeNull();
  });
});

describe("targetingIsValid", () => {
  it("accepts a manual campaign, which needs no predicate at all", () => {
    expect(targetingIsValid(MANUAL_TARGETING)).toBe(true);
  });

  // Mirrors policy_campaign_targeting_predicate_check. The database is what enforces it; this
  // only exists so the button disables instead of the insert raising at the user.
  it("rejects a declarative campaign with no conditions", () => {
    expect(targetingIsValid({ ...MANUAL_TARGETING, mode: "declarative" })).toBe(false);
  });

  it("accepts any single condition", () => {
    const base = { ...MANUAL_TARGETING, mode: "declarative" as const };
    expect(targetingIsValid({ ...base, facilityIds: ["f1"] })).toBe(true);
    expect(targetingIsValid({ ...base, facilityType: "PCH" })).toBe(true);
    expect(targetingIsValid({ ...base, workerType: "agency" })).toBe(true);
    expect(targetingIsValid({ ...base, jobTitlePattern: "Aide" })).toBe(true);
  });

  it("does not count an empty facility list or a whitespace title as a condition", () => {
    const base = { ...MANUAL_TARGETING, mode: "declarative" as const };
    expect(targetingIsValid({ ...base, facilityIds: [] })).toBe(false);
    expect(targetingIsValid({ ...base, jobTitlePattern: "   " })).toBe(false);
  });
});
