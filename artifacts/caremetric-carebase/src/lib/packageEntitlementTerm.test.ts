import { describe, expect, it } from "vitest";
import {
  entitlementTermIssues,
  parseEntitlementValue,
  termSummary,
  type EntitlementTermForm,
} from "./packageEntitlementTerm";

const NOW = new Date("2026-08-04T12:00:00.000Z");

const form = (overrides: Partial<EntitlementTermForm> = {}): EntitlementTermForm => ({
  packageId: "pkg-1",
  featureKey: "modules.billing",
  rawValue: "true",
  valueType: "boolean",
  reason: "Signed the September expansion",
  effectiveFrom: "2026-09-01T00:00:00.000Z",
  effectiveTo: "",
  contractReference: "CM-2026-0142",
  ...overrides,
});

describe("parseEntitlementValue", () => {
  it("accepts only true and false for a boolean feature", () => {
    expect(parseEntitlementValue("true", "boolean")).toMatchObject({ ok: true, value: true });
    expect(parseEntitlementValue("false", "boolean")).toMatchObject({ ok: true, value: false });
    expect(parseEntitlementValue("yes", "boolean").ok).toBe(false);
    expect(parseEntitlementValue("1", "boolean").ok).toBe(false);
  });

  it("requires a whole number for an integer feature, not just any number", () => {
    expect(parseEntitlementValue("250", "integer")).toMatchObject({ ok: true, value: 250 });
    expect(parseEntitlementValue("-5", "integer")).toMatchObject({ ok: true, value: -5 });
    expect(parseEntitlementValue("250.5", "integer").ok).toBe(false);
  });

  it("accepts a fractional decimal", () => {
    expect(parseEntitlementValue("2.5", "decimal")).toMatchObject({ ok: true, value: 2.5 });
    expect(parseEntitlementValue("not a number", "decimal").ok).toBe(false);
  });

  it("trims a string value", () => {
    expect(parseEntitlementValue("  premium  ", "string")).toMatchObject({ ok: true, value: "premium" });
  });

  it("parses a JSON document and names bad JSON as such", () => {
    expect(parseEntitlementValue('{"tier":"gold"}', "json")).toMatchObject({ ok: true, value: { tier: "gold" } });
    expect(parseEntitlementValue("{tier:gold}", "json").error).toMatch(/valid JSON/i);
  });

  it("refuses an empty value for every type", () => {
    for (const type of ["boolean", "integer", "decimal", "string", "json"] as const) {
      expect(parseEntitlementValue("   ", type).ok).toBe(false);
    }
  });
});

describe("entitlementTermIssues", () => {
  it("accepts a complete future-dated term", () => {
    expect(entitlementTermIssues(form(), NOW)).toEqual([]);
  });

  it("requires the reason the server requires", () => {
    expect(entitlementTermIssues(form({ reason: "  " }), NOW))
      .toContainEqual(expect.stringMatching(/audit reason/i));
  });

  it("refuses an end that does not follow the start, matching the check constraint", () => {
    expect(entitlementTermIssues(form({ effectiveTo: "2026-09-01T00:00:00.000Z" }), NOW)).toHaveLength(1);
    expect(entitlementTermIssues(form({ effectiveTo: "2026-08-01T00:00:00.000Z" }), NOW)).toHaveLength(1);
    expect(entitlementTermIssues(form({ effectiveTo: "2027-09-01T00:00:00.000Z" }), NOW)).toEqual([]);
  });

  it("accepts an open-ended term", () => {
    expect(entitlementTermIssues(form({ effectiveTo: "" }), NOW)).toEqual([]);
  });

  it("accepts a term starting today", () => {
    expect(entitlementTermIssues(form({ effectiveFrom: NOW.toISOString() }), NOW)).toEqual([]);
  });

  it("refuses a backdated term, which the server would reject as colliding", () => {
    expect(entitlementTermIssues(form({ effectiveFrom: "2026-01-01T00:00:00.000Z" }), NOW))
      .toContainEqual(expect.stringMatching(/backdated/i));
  });

  it("reports the value problem alongside the others rather than stopping at the first", () => {
    expect(entitlementTermIssues(form({ rawValue: "maybe", reason: "" }), NOW)).toHaveLength(2);
  });
});

describe("termSummary", () => {
  it("reads a future term as scheduled", () => {
    expect(termSummary(form(), NOW)).toContain("modules.billing becomes true from");
    expect(termSummary(form(), NOW)).toContain("no end date");
  });

  it("reads a term starting now as immediate", () => {
    expect(termSummary(form({ effectiveFrom: NOW.toISOString() }), NOW))
      .toContain("becomes true immediately");
  });

  it("names the end date when there is one", () => {
    expect(termSummary(form({ effectiveTo: "2027-01-01T00:00:00.000Z" }), NOW)).toMatch(/until/);
  });

  it("does not pretend a bad value parsed", () => {
    expect(termSummary(form({ rawValue: "maybe" }), NOW)).toContain("becomes ?");
  });

  it("renders a numeric limit as a number, not a quoted string", () => {
    expect(termSummary(form({ featureKey: "limits.learners", rawValue: "250", valueType: "integer" }), NOW))
      .toContain("becomes 250");
  });
});
