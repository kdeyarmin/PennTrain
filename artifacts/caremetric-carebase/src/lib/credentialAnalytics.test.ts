import { describe, expect, it } from "vitest";
import { summarizeCredentialAnalytics } from "./credentialAnalytics";

describe("summarizeCredentialAnalytics", () => {
  it("summarizes credential gaps and prioritizes risk", () => {
    const summary = summarizeCredentialAnalytics([
      { id: "expired", employee_id: "e1", credential_type: "rn_license", credential_label: null, status: "expired", expiration_date: "2026-07-01", warning_days: 90, last_verified_date: null },
      { id: "soon", employee_id: "e2", credential_type: "tb_screening", credential_label: null, status: "due_soon", expiration_date: "2026-07-20", warning_days: 30, last_verified_date: "2026-01-01" },
      { id: "ok", employee_id: "e2", credential_type: "i9_employment_eligibility", credential_label: null, status: "compliant", expiration_date: null, warning_days: 90, last_verified_date: "2026-01-01" },
      { id: "missing", employee_id: "e3", credential_type: "act34_criminal_history", credential_label: null, status: "missing", expiration_date: null, warning_days: 90, last_verified_date: null },
    ], "2026-07-10");

    expect(summary).toMatchObject({ expired: 1, dueSoon: 1, missing: 1, employeesWithGaps: 3, expiringWithin30Days: 1, unverified: 2 });
    expect(summary.topRiskCredentialIds.slice(0, 2)).toEqual(["expired", "missing"]);
  });
});
