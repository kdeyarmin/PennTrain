import { describe, expect, it } from "vitest";
import {
  CITATION_REVIEW_MAX_AGE_DAYS, citationDisplayLabel, citationForComplianceItem,
  citationLibraryAgeInDays, citationsForModule, findCitation,
  governedStatusByCitation, governedStatusSuffix, isCitationLibraryStale,
  PA_CITATIONS_LAST_VERIFIED, PA_REGULATORY_CITATIONS,
} from "./paRegulatoryCitations";

describe("catalog governance", () => {
  it("gives every citation provenance and a source link, and claims no verification of its own", () => {
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
      expect(entry.provenance.note.length).toBeGreaterThan(20);
      // The whole point of F10: this library records where its wording came from and does NOT
      // carry a verification status. It used to, and every entry said "verified" while
      // dhs_citation_topics said `approximate` or `unverified` for the same sections.
      expect(entry).not.toHaveProperty("verification");
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

  it("keeps the RCG grace-period evidence in the provenance of the two entries it settled", () => {
    // 2600.141 (PCH medical evaluation) and 2800.225 (ALF annual reassessment) are the two whose
    // grace periods PA DHS's own Regulatory Compliance Guides settled on 2026-08-04. That research
    // is the reason those figures are in the rule packs, so it has to survive here as provenance
    // even though this module no longer asserts a verification status from it.
    expect(findCitation("2600.141")!.provenance.note).toContain("2600 Regulatory Compliance Guide");
    expect(findCitation("2800.225")!.provenance.note.length).toBeGreaterThan(20);
  });

  it("says 'not verified' when no governed status is supplied, rather than staying silent", () => {
    // The truthful default. Every entry in this library is currently in exactly this position:
    // record_citation_verification() has never been invoked for any citation, so nothing is
    // governed-verified, and a label that said nothing would read as settled.
    const label = citationDisplayLabel(findCitation("2600.225")!);
    expect(label).toBe("55 Pa. Code § 2600.225 — Initial and annual assessment (not verified)");
  });

  it("reflects the governed status it is given, and adds nothing once verified", () => {
    const entry = findCitation("2600.225")!;
    expect(citationDisplayLabel(entry, "verified")).toBe("55 Pa. Code § 2600.225 — Initial and annual assessment");
    expect(citationDisplayLabel(entry, "approximate")).toContain("approximate");
    expect(citationDisplayLabel(entry, "superseded")).toContain("superseded");
    expect(citationDisplayLabel(entry, "unverified")).toContain("not verified");
  });

  it("treats a missing governed row the same as an explicit unverified one", () => {
    expect(governedStatusSuffix(undefined)).toBe(governedStatusSuffix("unverified"));
    expect(governedStatusSuffix(null)).toBe(governedStatusSuffix("unverified"));
  });

  it("indexes governed statuses by citation, splitting rows that name several sections", () => {
    const byRef = governedStatusByCitation([
      { citation_ref: "2600.141", verification_status: "approximate" },
      { citation_ref: "2600.65 / 2800.65", verification_status: "verified" },
      { citation_ref: null, verification_status: "unverified" },
    ]);
    expect(byRef["2600.141"]).toBe("approximate");
    expect(byRef["2600.65"]).toBe("verified");
    expect(byRef["2800.65"]).toBe("verified");
    expect(Object.keys(byRef)).toHaveLength(3);
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
