import { describe, expect, it } from "vitest";
import { endGrantIssues, grantAgeLabel } from "./enterpriseAccessGrants";

const base = {
  reason: "Left the region on 1 August",
  effectiveTo: "2026-08-04T12:00:00.000Z",
  effectiveFrom: "2026-01-04T12:00:00.000Z",
};

describe("endGrantIssues", () => {
  it("accepts a complete form", () => {
    expect(endGrantIssues(base)).toEqual([]);
  });

  it("requires a reason, since it is appended to the permanent record", () => {
    expect(endGrantIssues({ ...base, reason: "   " })).toHaveLength(1);
    expect(endGrantIssues({ ...base, reason: "   " })[0]).toMatch(/permanent reason/i);
  });

  it("refuses an end that precedes the start", () => {
    expect(endGrantIssues({ ...base, effectiveTo: "2025-12-01T00:00:00.000Z" })[0])
      .toMatch(/after the grant started/i);
  });

  it("refuses an end exactly at the start, matching the server's <= check", () => {
    expect(endGrantIssues({ ...base, effectiveTo: base.effectiveFrom })).toHaveLength(1);
  });

  it("accepts an end one millisecond after the start", () => {
    expect(endGrantIssues({ ...base, effectiveTo: "2026-01-04T12:00:00.001Z" })).toEqual([]);
  });

  it("reports an unparseable end date without also claiming it precedes the start", () => {
    const issues = endGrantIssues({ ...base, effectiveTo: "not a date" });
    expect(issues).toEqual([expect.stringMatching(/valid end date/i)]);
  });

  it("reports every problem at once", () => {
    expect(endGrantIssues({ ...base, reason: "", effectiveTo: "2020-01-01T00:00:00.000Z" }))
      .toHaveLength(2);
  });
});

describe("grantAgeLabel", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");

  it("reads today as today rather than zero days", () => {
    expect(grantAgeLabel("2026-08-04T09:00:00.000Z", now)).toBe("standing since today");
  });

  it("singularises one day", () => {
    expect(grantAgeLabel("2026-08-03T09:00:00.000Z", now)).toBe("standing 1 day");
  });

  it("counts days up to two months, then months", () => {
    expect(grantAgeLabel("2026-07-04T12:00:00.000Z", now)).toBe("standing 31 days");
    expect(grantAgeLabel("2026-01-04T12:00:00.000Z", now)).toBe("standing 7 months");
  });

  it("switches to years past two, where a month count stops meaning anything", () => {
    expect(grantAgeLabel("2023-08-04T12:00:00.000Z", now)).toBe("standing 3 years");
  });

  it("does not report a future grant as negative", () => {
    expect(grantAgeLabel("2026-09-01T12:00:00.000Z", now)).toBe("not yet effective");
  });

  it("does not invent an age for an unparseable date", () => {
    expect(grantAgeLabel("whenever", now)).toBe("unknown age");
  });
});
