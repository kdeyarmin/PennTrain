import { describe, expect, it } from "vitest";
import { allowsResidentContractAfterAdmission, residentRegulatoryPolicy } from "./residentRegulatoryPolicy";

describe("resident regulatory policy scope", () => {
  it("uses the ALR 24-hour contract window without granting it to PCH or an unknown license", () => {
    expect(allowsResidentContractAfterAdmission("ALR", null)).toBe(true);
    expect(allowsResidentContractAfterAdmission("PCH", { alf_contract_timing: "within_24_hours" })).toBe(false);
    expect(allowsResidentContractAfterAdmission(undefined, null)).toBe(false);
    expect(residentRegulatoryPolicy("NH", null)).toBeNull();
  });

  it("does not silently replace a facility's documented stricter decision", () => {
    const recorded = {
      alf_admission_grace_days: 0,
      alf_contract_timing: "before_admission",
      revision_grace_days: 0,
      medication_reportability: "all_events",
      decision_reason: "Facility elected earlier internal completion targets",
      decided_at: "2026-09-01T14:00:00Z",
    };
    expect(residentRegulatoryPolicy("ALR", recorded)).toEqual(recorded);
    expect(allowsResidentContractAfterAdmission("ALR", recorded)).toBe(false);
  });

  it("uses supported grace and error categories without resolving contradictory ALR admission guidance", () => {
    for (const license of ["PCH", "ALR"]) {
      const policy = residentRegulatoryPolicy(license, null);
      expect(policy?.revision_grace_days).toBe(5);
      expect(policy?.medication_reportability).toBe("statutory_errors");
    }
    expect(residentRegulatoryPolicy("ALR", null)?.alf_admission_grace_days).toBe(0);
    expect(residentRegulatoryPolicy("ALR", { alf_admission_grace_days: 15 })?.alf_admission_grace_days).toBe(15);
  });
});
