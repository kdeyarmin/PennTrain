import { describe, expect, it } from "vitest";
import { archivePlanIssues, legalHoldWarning, shortDigest } from "./auditArchivePlan";

const range = { from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" };

describe("archivePlanIssues", () => {
  it("accepts a well-formed range with rows in it", () => {
    expect(archivePlanIssues(range, 4200)).toEqual([]);
  });

  it("requires both ends of the range", () => {
    expect(archivePlanIssues({ from: "", to: range.to }, 1)).toHaveLength(1);
    expect(archivePlanIssues({ from: range.from, to: "" }, 1)).toHaveLength(1);
  });

  it("refuses a range that runs backwards", () => {
    expect(archivePlanIssues({ from: range.to, to: range.from }, 1))
      .toContainEqual(expect.stringMatching(/after its start/i));
  });

  it("refuses a zero-length range", () => {
    expect(archivePlanIssues({ from: range.from, to: range.from }, 1)).toHaveLength(1);
  });

  it("stops an empty batch, which the server would otherwise record permanently", () => {
    expect(archivePlanIssues(range, 0)).toContainEqual(expect.stringMatching(/nothing to archive/i));
  });

  it("does not treat an unknown row count as empty", () => {
    expect(archivePlanIssues(range, null)).toEqual([]);
  });

  it("reports the range and the emptiness together rather than one at a time", () => {
    expect(archivePlanIssues({ from: range.to, to: range.from }, 0)).toHaveLength(2);
  });
});

describe("legalHoldWarning", () => {
  it("stays quiet when nothing is on hold", () => {
    expect(legalHoldWarning(0, true)).toBeNull();
  });

  it("says the plan still succeeds but the batch carries a flag", () => {
    const warning = legalHoldWarning(2, true);
    expect(warning).toMatch(/flagged/i);
    expect(warning).not.toMatch(/cannot|blocked|refused/i);
  });

  it("singularises one hold", () => {
    expect(legalHoldWarning(1, true)).toContain("1 legal hold is active");
    expect(legalHoldWarning(2, true)).toContain("2 legal holds are active");
  });

  it("is stronger for a platform-wide plan, which any hold covers", () => {
    expect(legalHoldWarning(1, false)).toMatch(/covered by any of them/i);
    expect(legalHoldWarning(1, true)).toMatch(/if one covers this organization/i);
  });
});

describe("shortDigest", () => {
  it("shortens a real digest and marks it as shortened", () => {
    expect(shortDigest("a".repeat(64))).toBe(`${"a".repeat(16)}…`);
  });

  it("does not render an empty digest as an ellipsis", () => {
    expect(shortDigest("")).toBe("not computed");
  });
});
