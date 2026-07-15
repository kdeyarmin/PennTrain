import { describe, expect, it } from "vitest";
import { ENTERPRISE_OPERATION_GUARDRAILS, metricHasSafeDenominator, summarizeSetupProgress } from "./enterpriseOperations";

describe("enterprise operations helpers", () => {
  it("summarizes guided setup progress", () => {
    expect(summarizeSetupProgress([
      { key: "facility", label: "Facility", complete: true, why: "Scope" },
      { key: "users", label: "Users", complete: false, why: "Access" },
    ])).toEqual({ total: 2, complete: 1, remaining: 1, percent: 50 });
  });

  it("rejects zero denominators for compliance percentages", () => {
    expect(metricHasSafeDenominator({ denominator: 0 })).toBe(false);
    expect(metricHasSafeDenominator({ denominator: 1 })).toBe(true);
    expect(metricHasSafeDenominator({ denominator: null })).toBe(true);
  });

  it("documents secret and authorization guardrails", () => {
    expect(ENTERPRISE_OPERATION_GUARDRAILS.join(" ")).toContain("never returned to React");
    expect(ENTERPRISE_OPERATION_GUARDRAILS.join(" ")).toContain("separately from authorization");
  });
});
