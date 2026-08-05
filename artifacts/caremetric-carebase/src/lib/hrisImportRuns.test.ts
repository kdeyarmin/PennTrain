import { describe, expect, it } from "vitest";
import { importRunIssues, importRunStatusLabel, suggestedRequestId } from "./hrisImportRuns";

describe("importRunIssues", () => {
  it("accepts a complete form", () => {
    expect(importRunIssues({ sourceSystemId: "src-1", requestId: "workday-202608041200" })).toEqual([]);
  });

  it("requires a source system", () => {
    expect(importRunIssues({ sourceSystemId: "", requestId: "workday-202608041200" }))
      .toContainEqual(expect.stringMatching(/source system/i));
  });

  it("enforces the server's 8-character floor exactly", () => {
    expect(importRunIssues({ sourceSystemId: "s", requestId: "1234567" })).toHaveLength(1);
    expect(importRunIssues({ sourceSystemId: "s", requestId: "12345678" })).toEqual([]);
  });

  it("counts the trimmed length, as the server's btrim does", () => {
    expect(importRunIssues({ sourceSystemId: "s", requestId: "   1234   " })).toHaveLength(1);
  });

  it("enforces the 200-character ceiling", () => {
    expect(importRunIssues({ sourceSystemId: "s", requestId: "a".repeat(200) })).toEqual([]);
    expect(importRunIssues({ sourceSystemId: "s", requestId: "a".repeat(201) })).toHaveLength(1);
  });

  it("does not report both a floor and a ceiling problem at once", () => {
    expect(importRunIssues({ sourceSystemId: "s", requestId: "" })).toHaveLength(1);
  });
});

describe("suggestedRequestId", () => {
  it("is derived from the source and the minute, so it clears the 8-character floor", () => {
    const id = suggestedRequestId("workday", new Date("2026-08-04T12:34:56.789Z"));
    expect(id).toBe("workday-202608041234");
    expect(importRunIssues({ sourceSystemId: "s", requestId: id })).toEqual([]);
  });

  it("collapses two starts in the same minute, so a double-click makes one run", () => {
    expect(suggestedRequestId("workday", new Date("2026-08-04T12:34:01.000Z")))
      .toBe(suggestedRequestId("workday", new Date("2026-08-04T12:34:59.000Z")));
  });

  it("separates two different minutes", () => {
    expect(suggestedRequestId("workday", new Date("2026-08-04T12:34:00.000Z")))
      .not.toBe(suggestedRequestId("workday", new Date("2026-08-04T12:35:00.000Z")));
  });

  it("separates two different sources in the same minute", () => {
    const at = new Date("2026-08-04T12:34:00.000Z");
    expect(suggestedRequestId("workday", at)).not.toBe(suggestedRequestId("adp", at));
  });
});

describe("importRunStatusLabel", () => {
  it("says what a staging run is actually waiting for", () => {
    expect(importRunStatusLabel("staging")).toBe("Awaiting staged rows");
  });

  it("passes an unrecognised status through rather than hiding it", () => {
    expect(importRunStatusLabel("something_new")).toBe("something_new");
  });
});
