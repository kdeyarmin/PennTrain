import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  categoryMeta,
  REGULATORY_CATEGORIES,
  slugifyTitle,
  updateFacilityLabels,
} from "./regulatoryUpdates";

describe("categoryMeta", () => {
  it("returns metadata for every known category", () => {
    for (const meta of REGULATORY_CATEGORIES) {
      expect(categoryMeta(meta.value).label).toBe(meta.label);
    }
  });

  it("falls back to Update for unknown or missing categories", () => {
    expect(categoryLabel("not_a_category")).toBe("Update");
    expect(categoryLabel(null)).toBe("Update");
    expect(categoryLabel(undefined)).toBe("Update");
  });
});

describe("updateFacilityLabels", () => {
  it("maps stored ALR code to the ALF label (never 'Residence')", () => {
    const labels = updateFacilityLabels(["ALR"]);
    expect(labels).toEqual(["Assisted Living Facility (ALF)"]);
    expect(labels.join(" ")).not.toContain("Residence");
  });

  it("maps PCH and returns an empty array when broadly applicable", () => {
    expect(updateFacilityLabels(["PCH"])).toEqual(["Personal Care Home (PCH)"]);
    expect(updateFacilityLabels([])).toEqual([]);
    expect(updateFacilityLabels(null)).toEqual([]);
  });
});

describe("slugifyTitle", () => {
  it("produces a slug matching the DB constraint", () => {
    const slug = slugifyTitle("PCH Annual Training: 12 Hours (2600.65)!");
    expect(slug).toBe("pch-annual-training-12-hours-2600-65");
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("trims trailing separators and caps length", () => {
    expect(slugifyTitle("  Hello   World  ")).toBe("hello-world");
    expect(slugifyTitle("!!!")).toBe("");
  });
});
