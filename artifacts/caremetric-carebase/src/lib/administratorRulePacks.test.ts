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

  it("keeps CE compliant while newer hours still cover 24 after old entries age out", () => {
    const rules = buildAdministratorRulePack("PCH", {
      today: "2026-07-13",
      profile: null,
      ceEntries: [
        { completed_date: "2025-07-20", hours: 5 },
        { completed_date: "2026-03-01", hours: 24 },
      ],
    });
    const ce = rules.find((rule) => rule.id === "administrator-continuing-education");

    // The 5-hour entry ages out on 2026-07-21, but the remaining 24 hours still
    // satisfy the requirement, so nothing is actually due within 30 days.
    expect(ce?.status).toBe("compliant");
    expect(ce?.dueDate).toBe("2027-03-01");
  });

  it("flags CE due_soon when aging-out entries will drop the window below 24 hours", () => {
    const rules = buildAdministratorRulePack("PCH", {
      today: "2026-07-13",
      profile: null,
      ceEntries: [
        { completed_date: "2025-07-20", hours: 10 },
        { completed_date: "2026-03-01", hours: 16 },
      ],
    });
    const ce = rules.find((rule) => rule.id === "administrator-continuing-education");

    expect(ce?.status).toBe("due_soon");
    expect(ce?.dueDate).toBe("2026-07-20");
  });

  it("does not mark a course-qualified administrator expired from a stale NHA date", () => {
    const rules = buildAdministratorRulePack("PCH", {
      today: "2026-07-13",
      profile: {
        qualification_path: "hundred_hour_course",
        hundred_hour_course_completed_date: "2026-01-01",
        hundred_hour_course_document_path: "admin/course.pdf",
        competency_test_passed: true,
        competency_test_date: "2026-01-15",
        nha_license_expiration: "2020-01-01",
      },
      ceEntries: [],
    });
    const qualification = rules.find((rule) => rule.id === "pch-administrator-qualification");

    expect(qualification?.status).toBe("compliant");
    expect(qualification?.dueDate).toBeNull();
  });

  it("flags expired administrator documentation", () => {
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
