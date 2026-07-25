import { describe, expect, it } from "vitest";
import {
  CITATION_REVERIFICATION_INTERVAL_DAYS,
  citationDisplay,
  inlineCitation,
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
