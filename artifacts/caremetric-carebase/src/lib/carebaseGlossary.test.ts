import { describe, expect, it } from "vitest";
import { CAREBASE_GLOSSARY_TERMS, searchCarebaseGlossary } from "./carebaseGlossary";

describe("carebase glossary", () => {
  it("standardizes the core terms called out in the Phase 2 backlog", () => {
    const terms = CAREBASE_GLOSSARY_TERMS.map((entry) => entry.term.toLowerCase());

    expect(terms).toEqual(expect.arrayContaining([
      "work item",
      "task",
      "alert",
      "violation",
      "incident",
    ]));
  });

  it("searches by term, definition, category, and related route", () => {
    expect(searchCarebaseGlossary("work item").map((entry) => entry.term)).toContain("Work item");
    expect(searchCarebaseGlossary("regulatory deficiency").map((entry) => entry.term)).toContain("Violation");
    expect(searchCarebaseGlossary("security").map((entry) => entry.term)).toEqual(
      expect.arrayContaining(["Audit log", "Guest access", "Public token"]),
    );
    expect(searchCarebaseGlossary("/app/qapi").map((entry) => entry.term)).toContain("QAPI");
    expect(searchCarebaseGlossary("/app/work").map((entry) => entry.term)).toEqual(
      expect.arrayContaining(["Work item", "Task"]),
    );
  });

  it("returns all terms for blank searches and none for unmatched searches", () => {
    expect(searchCarebaseGlossary("   ")).toHaveLength(CAREBASE_GLOSSARY_TERMS.length);
    expect(searchCarebaseGlossary("not-a-carebase-term")).toEqual([]);
  });
});
