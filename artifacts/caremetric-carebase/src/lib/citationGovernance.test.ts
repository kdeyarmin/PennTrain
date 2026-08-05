import { describe, expect, it } from "vitest";
import {
  CITATION_REVERIFICATION_INTERVAL_DAYS,
  citationDisplay,
  inlineCitation,
  verificationFormIssues, supersessionFormIssues,
} from "./citationGovernance";

const TODAY = new Date("2026-07-25T12:00:00Z");

describe("citation display governance", () => {
  it("shows a verified, current citation with no qualifier", () => {
    const display = citationDisplay(
      { citation_ref: "2600.65", verification_status: "verified", verified_on: "2026-06-01" },
      TODAY,
    );
    expect(display).toMatchObject({ text: "2600.65", qualifier: null, citable: true });
  });

  // The whole point: the qualifier travels with the number rather than being stripped at the UI.
  it("never presents an approximate citation as though it were checked", () => {
    const display = citationDisplay(
      { citation_ref: "2600.65 / 2800.69", verification_status: "approximate" },
      TODAY,
    );
    expect(display.text).toBe("2600.65 / 2800.69");
    expect(display.qualifier).toBe("approximate");
    expect(display.citable).toBe(false);
  });

  it("still shows the reference rather than hiding it", () => {
    // Hiding an unverified citation would lose information the operator already has. The fix is to
    // qualify it, not to suppress it.
    for (const status of ["unverified", "approximate", "superseded"]) {
      const display = citationDisplay(
        { citation_ref: "2600.65", verification_status: status, superseded_by_ref: "2600.66" },
        TODAY,
      );
      expect(display.text).toBe("2600.65");
    }
  });

  it("names the successor when a citation was superseded", () => {
    const display = citationDisplay(
      { citation_ref: "2600.65", verification_status: "superseded", superseded_by_ref: "2600.66" },
      TODAY,
    );
    expect(display.qualifier).toBe("superseded by 2600.66");
    expect(display.detail).toContain("2600.66");
  });

  // A citation verified once and never re-checked is how a superseded section number survives in a
  // product for years.
  it("stops treating a verification as current once it is past the interval", () => {
    const stale = new Date(TODAY);
    stale.setDate(stale.getDate() - (CITATION_REVERIFICATION_INTERVAL_DAYS + 2));
    const display = citationDisplay(
      {
        citation_ref: "2600.65",
        verification_status: "verified",
        verified_on: stale.toISOString().slice(0, 10),
      },
      TODAY,
    );
    expect(display.qualifier).toBe("verification overdue");
    expect(display.citable).toBe(false);
  });

  it("keeps a verification current right up to the interval", () => {
    const edge = new Date(TODAY);
    edge.setDate(edge.getDate() - CITATION_REVERIFICATION_INTERVAL_DAYS);
    const display = citationDisplay(
      {
        citation_ref: "2600.65",
        verification_status: "verified",
        verified_on: edge.toISOString().slice(0, 10),
      },
      TODAY,
    );
    expect(display.citable).toBe(true);
  });

  // A status this code does not recognise is not a reason to assume the best.
  it("treats an unrecognised status as unverified", () => {
    const display = citationDisplay(
      { citation_ref: "2600.65", verification_status: "probably_fine" },
      TODAY,
    );
    expect(display.qualifier).toBe("unverified");
    expect(display.citable).toBe(false);
  });

  it("has nothing to show when there is no citation", () => {
    const display = citationDisplay({ citation_ref: null, verification_status: "unverified" }, TODAY);
    expect(display).toMatchObject({ text: null, qualifier: null, citable: false });
    expect(inlineCitation({ citation_ref: null, verification_status: "unverified" }, TODAY)).toBe("");
  });

  it("formats the inline form with the qualifier attached", () => {
    expect(
      inlineCitation({ citation_ref: "2600.65", verification_status: "approximate" }, TODAY),
    ).toBe(" (2600.65 — approximate)");
    expect(
      inlineCitation(
        { citation_ref: "2600.65", verification_status: "verified", verified_on: "2026-07-01" },
        TODAY,
      ),
    ).toBe(" (2600.65)");
  });

  // Guards the claim the module is built on: nothing but a current verification is citable.
  it("marks nothing citable except a current verification", () => {
    const statuses = ["unverified", "approximate", "superseded", "anything_else"];
    for (const status of statuses) {
      expect(citationDisplay({ citation_ref: "x", verification_status: status }, TODAY).citable)
        .toBe(false);
    }
  });
});

describe("verification form issues", () => {
  const TODAY = new Date("2026-08-04T12:00:00.000Z");
  const good = {
    citationRef: "2600.65",
    sourceUrl: "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2600/s2600.65.html",
    verifiedOn: "2026-08-04",
    today: TODAY,
  };

  it("accepts a verification that carries a ref, a source, and a sane date", () => {
    expect(verificationFormIssues(good)).toEqual([]);
  });

  it("refuses a verification with no source, in the words that say why", () => {
    // This is the whole mechanism: a claim nobody can retrace is not evidence.
    const issues = verificationFormIssues({ ...good, sourceUrl: "  " });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("not evidence");
  });

  it("refuses a source that is not a URL", () => {
    expect(verificationFormIssues({ ...good, sourceUrl: "I checked the book" })[0]).toContain("URL");
  });

  it("requires the section number", () => {
    expect(verificationFormIssues({ ...good, citationRef: "   " })[0]).toContain("section number");
  });

  it("refuses a verification dated in the future", () => {
    expect(verificationFormIssues({ ...good, verifiedOn: "2026-08-05" })[0]).toContain("future");
  });

  it("accepts today itself, which is the common case", () => {
    expect(verificationFormIssues({ ...good, verifiedOn: "2026-08-04" })).toEqual([]);
  });

  it("reports every problem at once rather than one at a time", () => {
    expect(verificationFormIssues({
      citationRef: "", sourceUrl: "", verifiedOn: "2026-12-01", today: TODAY,
    })).toHaveLength(3);
  });
});

describe("supersession form issues", () => {
  it("requires the successor reference", () => {
    expect(supersessionFormIssues({ supersededByRef: "  " })[0]).toContain("where to look");
  });

  it("accepts a named successor", () => {
    expect(supersessionFormIssues({ supersededByRef: "2600.66" })).toEqual([]);
  });
});
