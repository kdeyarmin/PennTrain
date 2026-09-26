import { describe, expect, it } from "vitest";
import { buildAdministratorRulePack, summarizeAdministratorRulePack, type AdministratorRulePackProfile } from "./administratorRulePacks";

describe("administrator rule packs", () => {
  it("does not infer ALF orientation or dementia evidence from a course or NHA license", () => {
    for (const profile of [{ hundred_hour_course_completed_date: "2026-01-01" }, { nha_license_number: "NHA123" }]) {
      expect(buildAdministratorRulePack("ALR", { profile, today: "2026-07-13" })
        .find(rule => rule.id === "alr-orientation-and-dementia")?.status).toBe("missing");
    }
  });
  it("checks separately documented ALF orientation and initial then annual dementia hours", () => {
    const profile = {
      first_employed_as_administrator_on: "2026-01-01", department_orientation_completed_date: "2025-12-20",
      department_orientation_document_path: "admin/orientation.pdf", dementia_initial_completed_date: "2026-01-20",
      dementia_initial_hours: 4, dementia_initial_document_path: "admin/dementia-initial.pdf",
    };
    const check = (today: string, patch: AdministratorRulePackProfile = {}) => buildAdministratorRulePack("ALR", { profile: { ...profile, ...patch }, today })
      .find(rule => rule.id === "alr-orientation-and-dementia")?.status;
    expect(check("2026-07-13")).toBe("compliant");
    expect(check("2026-07-13", { dementia_initial_hours: 3 })).toBe("missing");
    expect(check("2026-07-13", { dementia_initial_completed_date: "2026-02-15" })).toBe("missing");
    expect(check("2027-07-13")).toBe("missing");
    expect(check("2027-07-13", { dementia_annual_completed_date: "2027-01-20", dementia_annual_hours: 2, dementia_annual_document_path: "admin/annual.pdf" })).toBe("compliant");
  });
  it("credits the approved course for the first employment year only with dated qualification proof", () => {
    const profile = { qualification_path: "hundred_hour_course", hundred_hour_course_completed_date: "2025-12-01",
      hundred_hour_course_document_path: "admin/course.pdf", competency_test_passed: true, competency_test_date: "2025-12-02",
      first_employed_as_administrator_on: "2026-01-01" };
    const check = (today: string, patch: AdministratorRulePackProfile = {}) => buildAdministratorRulePack("PCH", { profile: { ...profile, ...patch }, today })
      .find(rule => rule.id === "administrator-continuing-education");
    expect(check("2026-07-13")).toMatchObject({ status: "compliant", dueDate: "2027-01-01" });
    expect(check("2027-01-01")?.status).toBe("missing");
    expect(check("2026-07-13", { first_employed_as_administrator_on: null })?.status).toBe("missing");
    expect(check("2026-07-13", { hundred_hour_course_document_path: null })?.status).toBe("missing");
  });
  it.each([
    ["2025-12-31", "missing"],
    ["2026-01-01", "compliant"],
    ["2026-01-31", "compliant"],
    ["2026-02-01", "missing"],
  ])("requires the initial dementia training within the hire-date window: %s", (completedOn, status) => {
    const profile = {
      first_employed_as_administrator_on: "2026-01-01",
      department_orientation_completed_date: "2025-12-20",
      department_orientation_document_path: "admin/orientation.pdf",
      dementia_initial_completed_date: completedOn,
      dementia_initial_hours: 4,
      dementia_initial_document_path: "admin/dementia-initial.pdf",
    };
    expect(buildAdministratorRulePack("ALR", { profile, today: "2026-07-13" })
      .find(rule => rule.id === "alr-orientation-and-dementia")?.status).toBe(status);
  });
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

  it("cites the chapter's own administrator sections for each facility type", () => {
    const pch = buildAdministratorRulePack("PCH", { today: "2026-07-13", profile: null, ceEntries: [] });
    const alr = buildAdministratorRulePack("ALR", { today: "2026-07-13", profile: null, ceEntries: [] });

    expect(pch.find((rule) => rule.id === "pch-administrator-qualification")?.citation).toBe("55 Pa. Code 2600.64");
    expect(pch.find((rule) => rule.id === "administrator-coverage")?.citation).toBe("55 Pa. Code 2600.56; 2600.64(e)");
    expect(pch.find((rule) => rule.id === "administrator-coverage")?.detail).toContain("20 hours a week");
    expect(alr.find((rule) => rule.id === "alr-approved-course-test")?.citation).toBe("55 Pa. Code 2800.64");
    expect(alr.find((rule) => rule.id === "alr-orientation-and-dementia")?.citation).toBe("55 Pa. Code 2800.64(a); 2800.69");
    expect(alr.find((rule) => rule.id === "administrator-coverage")?.citation).toBe("55 Pa. Code 2800.56; 2800.64(e)");
    expect(alr.find((rule) => rule.id === "administrator-coverage")?.detail).toContain("36 hours a week");
    for (const rule of [...pch, ...alr]) {
      expect(rule.detail).not.toMatch(/Assisted Living Residence|\bALR\b/);
    }
  });

  describe("licensed-NHA exemption (2600.64(g) / 2800.64(g))", () => {
    const nhaProfile = {
      qualification_path: "nha_exemption",
      nha_license_number: "NHA-123",
      nha_license_expiration: "2027-07-01",
    };
    const qualification = (facilityType: "PCH" | "ALR", profile: AdministratorRulePackProfile) =>
      buildAdministratorRulePack(facilityType, { today: "2026-07-13", profile, ceEntries: [] })
        .find((rule) => rule.id === (facilityType === "ALR" ? "alr-approved-course-test" : "pch-administrator-qualification"));

    it("does not read a licensed NHA as qualified with neither a test nor an employment date on file", () => {
      const pch = qualification("PCH", nhaProfile);
      const alr = qualification("ALR", nhaProfile);

      expect(pch?.status).toBe("missing");
      expect(pch?.detail).toContain("Record when this NHA was first employed as an administrator");
      expect(pch?.detail).toContain("before 10/24/2006");
      expect(pch?.detail).toContain("2600.64(g)");
      expect(alr?.status).toBe("missing");
      expect(alr?.detail).toContain("before 1/18/2011");
      expect(alr?.detail).toContain("2800.64(g)");
    });

    it("reads an NHA employed as administrator before the chapter's cutoff as exempt", () => {
      const pch = qualification("PCH", { ...nhaProfile, first_employed_as_administrator_on: "2006-10-23" });
      const alr = qualification("ALR", { ...nhaProfile, first_employed_as_administrator_on: "2011-01-17" });

      expect(pch?.status).toBe("compliant");
      expect(pch?.detail).toContain("before 10/24/2006, so 2600.64(g) exempts them");
      expect(alr?.status).toBe("compliant");
      expect(alr?.detail).toContain("before 1/18/2011, so 2800.64(g) exempts them");
    });

    it("requires the competency test from an NHA hired on or after the cutoff", () => {
      const pch = qualification("PCH", { ...nhaProfile, first_employed_as_administrator_on: "2006-10-24" });
      const alrOnTheDay = qualification("ALR", { ...nhaProfile, first_employed_as_administrator_on: "2011-01-18" });
      // Past the personal care home cutoff, but before the assisted living one.
      const between = { ...nhaProfile, first_employed_as_administrator_on: "2009-05-01" };

      expect(pch?.status).toBe("missing");
      expect(pch?.detail).toContain("first employed as an administrator on 10/24/2006");
      expect(pch?.detail).toContain("record the passed Department competency-based test");
      expect(alrOnTheDay?.status).toBe("missing");
      expect(qualification("PCH", between)?.status).toBe("missing");
      expect(qualification("ALR", between)?.status).toBe("compliant");
    });

    it("accepts a passed and dated test regardless of when the NHA was hired", () => {
      const tested = { ...nhaProfile, first_employed_as_administrator_on: "2020-03-01", competency_test_passed: true, competency_test_date: "2020-06-15" };
      const undated = { ...nhaProfile, competency_test_passed: true };

      expect(qualification("ALR", tested)?.status).toBe("compliant");
      expect(qualification("ALR", tested)?.detail).toBe("NHA exemption and the Department competency test are documented.");
      expect(qualification("PCH", undated)?.status).toBe("missing");
    });

    it("stops reading an exempt NHA as qualified once the license lapses", () => {
      const lapsed = qualification("PCH", { ...nhaProfile, nha_license_expiration: "2026-07-01", first_employed_as_administrator_on: "2001-01-01" });

      expect(lapsed?.status).toBe("missing");
      expect(lapsed?.detail).toBe("Missing approved-course/test proof or current NHA exemption documentation.");
    });

    it("flags an exempt NHA's license as due soon inside 30 days", () => {
      const expiring = qualification("PCH", { ...nhaProfile, nha_license_expiration: "2026-08-01", first_employed_as_administrator_on: "2001-01-01" });

      expect(expiring?.status).toBe("due_soon");
      expect(expiring?.dueDate).toBe("2026-08-01");
    });
  });
});
