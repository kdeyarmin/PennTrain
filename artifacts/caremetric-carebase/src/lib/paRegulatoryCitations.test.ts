import { describe, expect, it } from "vitest";
import {
  CITATION_REVIEW_MAX_AGE_DAYS, citationDisplayLabel, citationForComplianceItem,
  citationLibraryAgeInDays, citationsForModule, findCitation, isCitationLibraryStale,
  PA_CITATIONS_LAST_VERIFIED, PA_REGULATORY_CITATIONS,
  type PaRegulatoryCitation,
} from "./paRegulatoryCitations";

describe("catalog governance", () => {
  it("gives every citation provenance, a source link, and a verification posture", () => {
    // A citation with no recorded provenance is indistinguishable from one authored from memory,
    // which is the failure mode this library exists to prevent.
    for (const entry of PA_REGULATORY_CITATIONS) {
      expect(entry.citation).toMatch(/^2[68]00\.\d+$/);
      expect(entry.heading.length).toBeGreaterThan(0);
      expect(entry.requirement.length).toBeGreaterThan(0);
      expect(entry.responsibleRole.length).toBeGreaterThan(0);
      expect(entry.requiredFrequency.length).toBeGreaterThan(0);
      expect(entry.requiredEvidence.length).toBeGreaterThan(0);
      expect(entry.modules.length).toBeGreaterThan(0);
      expect(entry.sourceUrl).toMatch(/^https:\/\/www\.pacodeandbulletin\.gov\//);
      expect(entry.verification.note.length).toBeGreaterThan(20);
      expect(["verified", "pending_confirmation"]).toContain(entry.verification.status);
    }
  });

  it("keeps the chapter consistent with the section number and facility type", () => {
    for (const entry of PA_REGULATORY_CITATIONS) {
      expect(entry.citation.startsWith(entry.chapter)).toBe(true);
      // Ch. 2600 governs PCH; Ch. 2800 governs the ALF (stored code "ALR"). Crossing them would
      // put a personal-care-home deadline in front of an assisted-living administrator.
      expect(entry.facilityTypes).toEqual(entry.chapter === "2600" ? ["PCH"] : ["ALR"]);
    }
  });

  it("has no duplicate sections", () => {
    const citations = PA_REGULATORY_CITATIONS.map((entry) => entry.citation);
    expect(new Set(citations).size).toBe(citations.length);
  });

  it("resolves the two grace periods that were pending confirmation as of 2026-08-04", () => {
    // 2600.141 (PCH medical evaluation) and 2800.225 (ALR annual reassessment) were the last two
    // pending_confirmation entries -- both closed 2026-08-04 via PA DHS's own Regulatory
    // Compliance Guides naming each section directly in the chapter's Grace Periods table (see
    // their verification.note). Checked specifically rather than asserting every entry is
    // verified: pending_confirmation is a supported, ongoing status (see the module docstring),
    // not a defect to eliminate, and a future citation legitimately added as unconfirmed should
    // stay that way rather than force someone to mark it verified just to pass this test. The
    // mechanism that keeps an unconfirmed entry from displaying as settled is guarded by the
    // fixture test below.
    expect(findCitation("2600.141")!.verification.status).toBe("verified");
    expect(findCitation("2800.225")!.verification.status).toBe("verified");
  });

  it("carries an unconfirmed status forward rather than upgrading it silently", () => {
    // Exercised against a constructed fixture rather than a real entry: real data has had nothing
    // pending since 2026-08-04, and this guarantee should hold regardless of whether anything
    // currently does. Upgrading a status to "verified" without the label reflecting it would
    // launder an open question into a settled one.
    const pending: PaRegulatoryCitation = {
      ...PA_REGULATORY_CITATIONS[0],
      citation: "0000.000",
      verification: { status: "pending_confirmation", note: "test fixture, not a real citation" },
    };
    expect(citationDisplayLabel(pending)).toContain("(unconfirmed detail)");
    expect(citationDisplayLabel(findCitation("2600.225")!)).not.toContain("unconfirmed");
    expect(citationDisplayLabel(findCitation("2600.225")!)).toBe("55 Pa. Code § 2600.225 — Initial and annual assessment");
  });
});

describe("citationForComplianceItem", () => {
  it("maps each PCH assessment item to its governing section", () => {
    expect(citationForComplianceItem("preadmission_screening", "PCH")!.citation).toBe("2600.224");
    expect(citationForComplianceItem("initial_assessment_15day", "PCH")!.citation).toBe("2600.225");
    expect(citationForComplianceItem("support_plan_30day", "PCH")!.citation).toBe("2600.227");
    expect(citationForComplianceItem("annual_reassessment", "PCH")!.citation).toBe("2600.225");
    expect(citationForComplianceItem("medical_evaluation", "PCH")!.citation).toBe("2600.141");
  });

  it("maps the ALF support plan to 2800.224, which covers it alongside the initial assessment", () => {
    // This is the mapping the rule pack records; there is no separate ALR support-plan section, and
    // inventing a 2800.227 to mirror the PCH numbering would be exactly the wrong kind of guess.
    expect(citationForComplianceItem("support_plan_30day", "ALR")!.citation).toBe("2800.224");
    expect(citationForComplianceItem("initial_assessment_15day", "ALR")!.citation).toBe("2800.224");
    expect(citationForComplianceItem("annual_reassessment", "ALR")!.citation).toBe("2800.225");
  });

  it("returns undefined rather than guessing for an unmapped item or facility type", () => {
    expect(citationForComplianceItem("some_future_item", "PCH")).toBeUndefined();
    expect(citationForComplianceItem("annual_reassessment", "GROUP_HOME")).toBeUndefined();
    expect(citationForComplianceItem("annual_reassessment", null)).toBeUndefined();
    expect(citationForComplianceItem("annual_reassessment", undefined)).toBeUndefined();
  });
});

describe("citationsForModule", () => {
  it("filters by facility type when one is supplied", () => {
    const pch = citationsForModule("resident_assessment", "PCH");
    expect(pch.every((entry) => entry.chapter === "2600")).toBe(true);
    const alr = citationsForModule("resident_assessment", "ALR");
    expect(alr.every((entry) => entry.chapter === "2800")).toBe(true);
  });

  it("returns both chapters when the facility type is unknown", () => {
    const chapters = new Set(citationsForModule("resident_assessment").map((entry) => entry.chapter));
    expect(chapters).toEqual(new Set(["2600", "2800"]));
  });

  it("returns support-plan citations for both chapters", () => {
    expect(citationsForModule("support_plan", "PCH").map((entry) => entry.citation)).toEqual(["2600.227"]);
    expect(citationsForModule("support_plan", "ALR").map((entry) => entry.citation)).toEqual(["2800.224", "2800.225"]);
  });

  it("returns an empty list rather than throwing for a module with no citations at this facility", () => {
    expect(citationsForModule("admission", "PCH").length).toBeGreaterThan(0);
    expect(Array.isArray(citationsForModule("medical_evaluation", "ALR"))).toBe(true);
  });
});

describe("library staleness", () => {
  const verifiedAt = new Date(`${PA_CITATIONS_LAST_VERIFIED}T00:00:00Z`);

  it("reports zero age on the verification date", () => {
    expect(citationLibraryAgeInDays(verifiedAt)).toBe(0);
    expect(isCitationLibraryStale(verifiedAt)).toBe(false);
  });

  it("goes stale one day past the review window", () => {
    const atLimit = new Date(verifiedAt.getTime() + CITATION_REVIEW_MAX_AGE_DAYS * 86_400_000);
    const pastLimit = new Date(verifiedAt.getTime() + (CITATION_REVIEW_MAX_AGE_DAYS + 1) * 86_400_000);
    expect(isCitationLibraryStale(atLimit)).toBe(false);
    expect(isCitationLibraryStale(pastLimit)).toBe(true);
  });

  it("uses the same review cadence as the DHS form-source check", () => {
    // scripts/check-dhs-sources.mjs defaults DHS_SOURCE_MAX_AGE_DAYS to 45; drifting apart would
    // mean two different definitions of "recently reviewed" for the same body of source material.
    expect(CITATION_REVIEW_MAX_AGE_DAYS).toBe(45);
  });
});
