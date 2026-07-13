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
});
