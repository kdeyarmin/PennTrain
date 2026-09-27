import { describe, expect, it } from "vitest";
import { CAREBASE_GLOSSARY_TERMS, searchCarebaseGlossary } from "./carebaseGlossary";
import { ALL_PRODUCT_MODULE_IDS } from "./productModules";

describe("carebase glossary", () => {
  it("keeps definitions but hides unavailable administrator and guest links from employees", () => {
    const terms = searchCarebaseGlossary("", { role: "employee", enabledModules: new Set(ALL_PRODUCT_MODULE_IDS) });
    expect(terms).toHaveLength(CAREBASE_GLOSSARY_TERMS.length);
    expect(terms.find((entry) => entry.term === "Audit log")?.relatedRoutes).toEqual([]);
    expect(terms.find((entry) => entry.term === "Guest access")?.relatedRoutes).toEqual([]);
    expect(terms.flatMap((entry) => entry.relatedRoutes).some((route) => route.href.startsWith("/admin"))).toBe(false);
  });

  it("keeps Train-only learning links while hiding resident operations", () => {
    const terms = searchCarebaseGlossary("", { role: "org_admin", enabledModules: new Set(["core", "train"]) });
    expect(terms.find((entry) => entry.term === "Resident")?.relatedRoutes).toEqual([]);
    expect(terms.find((entry) => entry.term === "Course assignment")?.relatedRoutes).toEqual([{ label: "Courses", href: "/app/courses" }]);
    expect(CAREBASE_GLOSSARY_TERMS.find((entry) => entry.term === "Resident")?.relatedRoutes).toHaveLength(1);
  });

  it("does not offer navigation while the user's role is unresolved", () => {
    const terms = searchCarebaseGlossary("", { role: undefined, enabledModules: new Set(ALL_PRODUCT_MODULE_IDS) });
    expect(terms.flatMap((entry) => entry.relatedRoutes)).toEqual([]);
  });

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
