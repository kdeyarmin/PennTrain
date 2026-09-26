import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  getTemplateByCode,
  getTemplateComplianceMetadata,
  getTemplatesByCategory,
  searchTemplates,
} from "./documentTemplates";

describe("getTemplateByCode", () => {
  it("returns the matching template for a known code", () => {
    const template = getTemplateByCode("BF-01");
    expect(template).toBeDefined();
    expect(template?.code).toBe("BF-01");
  });

  it("returns undefined for an unknown code", () => {
    expect(getTemplateByCode("DOES-NOT-EXIST")).toBeUndefined();
  });
});

describe("getTemplatesByCategory", () => {
  it("returns only templates in the given category", () => {
    const category = TEMPLATE_CATEGORIES[0];
    const results = getTemplatesByCategory(category);
    expect(results.length).toBeGreaterThan(0);
    results.forEach((t) => expect(t.category).toBe(category));
  });

  it("returns an empty array for a category with no templates", () => {
    // Cast to bypass TS – runtime behaviour must still be correct
    const results = getTemplatesByCategory("Nonexistent Category" as never);
    expect(results).toEqual([]);
  });
});

describe("searchTemplates", () => {
  it("returns all templates for an empty query", () => {
    expect(searchTemplates("").length).toBe(DOCUMENT_TEMPLATES.length);
    expect(searchTemplates("   ").length).toBe(DOCUMENT_TEMPLATES.length);
  });

  it("matches on template code (case-insensitive)", () => {
    const results = searchTemplates("bf-01");
    expect(results.some((t) => t.code === "BF-01")).toBe(true);
  });

  it("matches on template title", () => {
    const target = DOCUMENT_TEMPLATES[0];
    const results = searchTemplates(target.title.slice(0, 8));
    expect(results.some((t) => t.code === target.code)).toBe(true);
  });

  it("matches on description text", () => {
    const target = DOCUMENT_TEMPLATES[0];
    const words = target.description.split(" ").slice(0, 2).join(" ");
    const results = searchTemplates(words);
    expect(results.some((t) => t.code === target.code)).toBe(true);
  });

  it("matches on category name", () => {
    const category = TEMPLATE_CATEGORIES[0];
    const results = searchTemplates(category.toLowerCase());
    expect(results.length).toBeGreaterThan(0);
    results.forEach((t) => expect(t.category).toBe(category));
  });

  it("returns an empty array when no templates match", () => {
    expect(searchTemplates("zzz_no_match_xyzzy")).toEqual([]);
  });
});


describe("getTemplateComplianceMetadata", () => {
  it("adds citation-aware metadata to templates", () => {
    const template = getTemplateByCode("BF-01");
    expect(template).toBeDefined();
    const metadata = getTemplateComplianceMetadata(template!);
    expect(metadata.facilityTypes).toEqual(["PCH", "ALR"]);
    expect(metadata.citations.length).toBeGreaterThan(0);
    expect(metadata.binderSection).toBeTruthy();
  });

  it("makes template search citation-aware", () => {
    expect(searchTemplates("2600.225").some((template) => template.category === "Resident Records & Care Plans")).toBe(true);
  });

  it("badges the Chapter 2600-only crosswalk for personal care homes alone", () => {
    const metadata = getTemplateComplianceMetadata(getTemplateByCode("FE-01")!);
    expect(metadata.facilityTypes).toEqual(["PCH"]);
    expect(metadata.citations).toEqual(["55 Pa. Code Ch. 2600"]);
  });
});

function templateText(code: string): string {
  const template = getTemplateByCode(code);
  expect(template).toBeDefined();
  return JSON.stringify(template);
}

describe("template text against Chapters 2600 and 2800", () => {
  it("cites only crosswalk ranges that begin at a real section", () => {
    const body = getTemplateByCode("FE-01")!.body;
    expect(body.kind).toBe("reference");
    const ranges = body.kind === "reference" ? body.rows.map((row) => row[0]) : [];
    // 2600.203-220 are reserved; the assessment and support-plan sections are 2600.224-227.
    expect(ranges).toContain("2600.224-227");
    expect(ranges.some((range) => /^2600\.2(0[3-9]|1\d|20)\b/.test(range))).toBe(false);
  });

  it("gives an ALF its 16 annual hours, not the PCH 12", () => {
    const text = templateText("FE-19");
    expect(text).toContain("12 hours in a PCH (2600.65(e))");
    expect(text).toContain("16 hours in an ALF (2800.65(h))");
  });

  it("does not leave the mandatory abuse-response steps to facility policy", () => {
    const text = templateText("FE-28");
    expect(text).not.toMatch(/if required by policy|per policy while/);
    expect(text).toContain("2600.15(b)");
    expect(text).toContain("2600.15(c)");
    expect(text).toContain("2600.15(d)");
    expect(text).toContain("within 48 hours (OAPSA, 6 Pa. Code 15.151)");
  });

  it("states the admission deadlines instead of a facility policy window", () => {
    const text = templateText("FE-10");
    expect(text).not.toContain("facility policy window");
    expect(text).toContain("within 15 days after admission (2600.225(a))");
    expect(text).toContain("final support plan within 30 days after admission (2800.227(a))");
  });

  it("holds the chemical-restraint review to the diagnosis test, not staff convenience", () => {
    const text = templateText("FE-13");
    expect(text).not.toContain("staff convenience");
    expect(text).toContain("2600.202(4) / 2800.202(4)");
    expect(text).toContain("A symptom such as agitation is not a diagnosis");
  });
});
