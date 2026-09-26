import { describe, expect, it } from "vitest";
import {
  PCH_ALR_OPERATIONS_ITEMS,
  buildInspectionDayChecklist,
  buildPchAlrEvidencePackage,
  evidencePackageToCsv,
  evidencePackageToText,
  getPchAlrItemsByDomain,
  getPchAlrItemsByProgram,
  searchPchAlrOperations,
} from "./pchAlrOperations";

describe("PCH/ALR operations catalog", () => {
  it("covers the ten requested improvement areas", () => {
    expect(PCH_ALR_OPERATIONS_ITEMS).toHaveLength(10);
    expect(new Set(PCH_ALR_OPERATIONS_ITEMS.map((item) => item.domain)).size).toBe(10);
  });

  it("splits PCH and ALR applicable workflows", () => {
    expect(getPchAlrItemsByProgram("PCH").length).toBeGreaterThan(0);
    expect(getPchAlrItemsByProgram("ALR").some((item) => item.citations.some((citation) => citation.includes("2800")))).toBe(true);
  });

  it("finds workflows by citation, documentation source, and title text", () => {
    expect(searchPchAlrOperations("2800.64").map((item) => item.id)).toContain("administrator-rule-packs");
    expect(searchPchAlrOperations("documentation room").map((item) => item.id)).toContain("inspection-day-package");
    expect(searchPchAlrOperations("grievance").map((item) => item.id)).toContain("rights-grievances");
  });

  it("finds ALF workflows by the label the page shows, not just the stored ALR code", () => {
    expect(searchPchAlrOperations("alf").map((item) => item.id)).toContain("special-care");
    expect(searchPchAlrOperations("assisted living").map((item) => item.id)).toContain("special-care");
    expect(searchPchAlrOperations("alr").map((item) => item.id)).toContain("special-care");
  });

  it("covers PCH secured dementia care units as well as ALF special care units", () => {
    const specialCare = PCH_ALR_OPERATIONS_ITEMS.find((item) => item.id === "special-care");
    expect(specialCare?.programs).toEqual(["PCH", "ALR"]);
    expect(specialCare?.citations).toEqual(["55 Pa. Code 2600.231–2600.239", "55 Pa. Code 2800.69, 2800.231–2800.239"]);
    expect(getPchAlrItemsByProgram("PCH").map((item) => item.id)).toContain("special-care");
  });

  it("returns domain-specific workflows", () => {
    expect(getPchAlrItemsByDomain("Medication safety")).toEqual([expect.objectContaining({ id: "medication-safety" })]);
  });

  it("builds one inspection prompt per catalog item", () => {
    expect(buildInspectionDayChecklist()).toHaveLength(PCH_ALR_OPERATIONS_ITEMS.length);
    expect(buildInspectionDayChecklist()[0]).toContain(":");
  });

  it("builds exportable documentation package sections from playbooks and queue counts", () => {
    const packageSections = buildPchAlrEvidencePackage({
      facilityName: "Example Home",
      asOfDate: "2026-07-13",
      items: PCH_ALR_OPERATIONS_ITEMS.filter((item) => item.id === "medication-safety"),
      queue: [{ id: "medication-safety", label: "Medication", count: 3, severity: "attention", route: "/app/med-admin-roster", guidance: "Close items" }],
    });

    expect(packageSections).toEqual([expect.objectContaining({ id: "medication-safety", openQueueCount: 3 })]);
    expect(evidencePackageToText(packageSections)).toContain("Example Home");
    expect(evidencePackageToCsv(packageSections)).toContain("open_queue_count");
  });
});
