import { describe, expect, it } from "vitest";
import { projectWorkforceImpact, remediationActionForReason } from "./workforceReadinessActions";

describe("workforce readiness actions", () => {
  it("projects coverage impact across horizons", () => {
    const projection = projectWorkforceImpact({
      activeEmployees: 40,
      currentBlockers: 4,
      horizons: [
        { days: 30, employeesAtRisk: 8 },
        { days: 60, employeesAtRisk: 12 },
        { days: 90, employeesAtRisk: 16 },
      ],
    });
    expect(projection.currentCoverageImpactPct).toBe(10);
    expect(projection.nearTermCoverageImpactPct).toBe(20);
    expect(projection.quarterCoverageImpactPct).toBe(40);
  });

  it("returns governed remediation copy by risk type", () => {
    expect(remediationActionForReason("credential").label).toMatch(/credential/i);
    expect(remediationActionForReason("training").label).toMatch(/training/i);
    expect(remediationActionForReason("duty_clearance").label).toMatch(/clearance/i);
  });
});
