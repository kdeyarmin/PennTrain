import { describe, expect, it } from "vitest";
import {
  DHS_FORM_CATEGORIES,
  DHS_FORMS,
  dhsFormFacilityTypeLabel,
  getFormsByCategory,
  searchDhsForms,
} from "./dhsFormsLibrary";

describe("DHS_FORMS", () => {
  it("has unique ids", () => {
    const ids = DHS_FORMS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only uses declared categories", () => {
    DHS_FORMS.forEach((f) => expect(DHS_FORM_CATEGORIES).toContain(f.category));
  });

  it("every form has at least one facility type and an https url", () => {
    DHS_FORMS.forEach((f) => {
      expect(f.facilityTypes.length).toBeGreaterThan(0);
      expect(f.url.startsWith("https://")).toBe(true);
    });
  });

  it("never says 'Assisted Living Residence' or bare 'ALR' in a displayed title", () => {
    DHS_FORMS.forEach((f) => {
      expect(f.title).not.toMatch(/Assisted Living Residence/i);
      expect(f.title).not.toMatch(/\bALR\b/);
    });
  });
});

describe("getFormsByCategory", () => {
  it("returns only forms in the given category", () => {
    const category = DHS_FORM_CATEGORIES[0];
    const results = getFormsByCategory(category);
    expect(results.length).toBeGreaterThan(0);
    results.forEach((f) => expect(f.category).toBe(category));
  });

  it("returns an empty array for a category with no forms", () => {
    expect(getFormsByCategory("Nonexistent Category" as never)).toEqual([]);
  });
});

describe("searchDhsForms", () => {
  it("returns all forms for an empty query", () => {
    expect(searchDhsForms("").length).toBe(DHS_FORMS.length);
    expect(searchDhsForms("   ").length).toBe(DHS_FORMS.length);
  });

  it("matches on title", () => {
    const results = searchDhsForms("reportable incident");
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("matches ALF search against ALR-tagged forms", () => {
    const results = searchDhsForms("alf");
    expect(results.some((f) => f.facilityTypes.includes("ALR"))).toBe(true);
  });

  it("matches on description text", () => {
    const target = DHS_FORMS[0];
    const words = target.description.split(" ").slice(0, 2).join(" ");
    const results = searchDhsForms(words);
    expect(results.some((f) => f.id === target.id)).toBe(true);
  });

  it("returns an empty array when nothing matches", () => {
    expect(searchDhsForms("zzz_no_match_xyzzy")).toEqual([]);
  });
});

describe("dhsFormFacilityTypeLabel", () => {
  it("relabels ALR as ALF", () => {
    expect(dhsFormFacilityTypeLabel("ALR")).toBe("ALF");
  });

  it("leaves other facility types unchanged", () => {
    expect(dhsFormFacilityTypeLabel("PCH")).toBe("PCH");
  });
});
