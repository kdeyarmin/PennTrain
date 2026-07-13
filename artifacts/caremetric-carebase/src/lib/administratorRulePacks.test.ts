import { describe, expect, it } from "vitest";
import { buildAdministratorRulePack, summarizeAdministratorRulePack } from "./administratorRulePacks";

describe("administrator rule packs", () => {
  it("evaluates PCH and ALR facilities with different rule packs", () => {
    const pch = buildAdministratorRulePack("PCH", {
      today: "2026-07-13",
      profile: {
        qualification_path: "hundred_hour_course",
        hundred_hour_course_completed_date: "2026-01-01",
        hundred_hour_course_document_path: "admin/course.pdf",
        competency_test_passed: true,
        competency_test_date: "2026-01-15",
        regional_office_verification_submitted_date: "2026-01-20",
      },
      ceEntries: [{ completed_date: "2026-03-01", hours: 24, topic: "PCH annual update" }],
    });
    const alr = buildAdministratorRulePack("ALR", {
      today: "2026-07-13",
      profile: null,
      ceEntries: [],
    });

    expect(pch.map((rule) => rule.id)).not.toContain("alr-orientation-and-dementia");
    expect(alr.map((rule) => rule.id)).toContain("alr-orientation-and-dementia");
    expect(summarizeAdministratorRulePack(pch).status).toBe("inspection_ready");
    expect(summarizeAdministratorRulePack(alr).status).toBe("needs_attention");
  });

  it("flags expired administrator evidence", () => {
    const rules = buildAdministratorRulePack("ALR", {
      today: "2026-07-13",
      profile: {
        qualification_path: "nha_exemption",
        nha_license_number: "NHA-123",
        nha_license_expiration: "2026-07-01",
      },
      ceEntries: [{ completed_date: "2026-02-01", hours: 12, topic: "Partial CE" }],
    });

    expect(rules.find((rule) => rule.id === "alr-approved-course-test")?.status).toBe("missing");
    expect(rules.find((rule) => rule.id === "administrator-continuing-education")?.status).toBe("missing");
    expect(summarizeAdministratorRulePack(rules).blockingCount).toBeGreaterThan(0);
  });
});
