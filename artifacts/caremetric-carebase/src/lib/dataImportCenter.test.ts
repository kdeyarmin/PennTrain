import { describe, expect, it } from "vitest";
import {
  IMPORT_DOMAIN_DEFINITIONS,
  IMPORT_DOMAINS,
  canUploadImportDomain,
  importProcessorFunction,
  canRollbackImportDomain,
  importColumns,
  importTemplate,
  isRequiredImportColumn,
  requiredImportColumns,
  rowsToErrorCsv,
} from "./dataImportCenter";

describe("data import center", () => {
  it("offers a versionable CSV template for every supported domain", () => {
    expect(IMPORT_DOMAINS).toHaveLength(8);
    for (const domain of IMPORT_DOMAINS) expect(importTemplate(domain)).toMatch(/.+,.+\n$/);
  });

  it("activates processors for all migration domains including assessments", () => {
    expect(IMPORT_DOMAIN_DEFINITIONS).toHaveLength(IMPORT_DOMAINS.length);
    const active = IMPORT_DOMAIN_DEFINITIONS.filter(({ availability }) => availability === "active").map(({ domain }) => domain);
    expect(active).toEqual([
      "employees",
      "training_records",
      "credentials",
      "residents",
      "resident_contacts",
      "rooms",
      "assessments",
      "incidents",
    ]);
    expect(canUploadImportDomain("employees")).toBe(true);
    expect(canUploadImportDomain("credentials")).toBe(true);
    expect(canUploadImportDomain("assessments")).toBe(true);
    expect(importProcessorFunction("credentials")).toBe("bulk-import-credentials");
    expect(importProcessorFunction("assessments")).toBe("bulk-import-assessments");
    expect(canRollbackImportDomain("credentials")).toBe(true);
    expect(canRollbackImportDomain("assessments")).toBe(true);
    expect(canRollbackImportDomain("incidents")).toBe(false);
  });

  it("exposes the canonical column order every domain's importTemplate is built from (D4 mapping UI reads this)", () => {
    for (const domain of IMPORT_DOMAINS) {
      expect(importTemplate(domain)).toBe(`${importColumns(domain).join(",")}\n`);
    }
  });

  it("marks each domain's required columns as a subset of its canonical columns", () => {
    for (const domain of IMPORT_DOMAINS) {
      const required = requiredImportColumns(domain);
      const canonical = importColumns(domain);
      for (const column of required) {
        expect(canonical).toContain(column);
        expect(isRequiredImportColumn(domain, column)).toBe(true);
      }
    }
    expect(isRequiredImportColumn("employees", "department")).toBe(false);
    expect(requiredImportColumns("incidents")).toEqual(["facility", "occurred_at", "incident_type", "severity", "summary"]);
  });

  it("exports row diagnostics without allowing commas or quotes to corrupt the CSV", () => {
    const csv = rowsToErrorCsv([
      { row_number: 2, source_row: { name: "Doe, Jane" }, errors: ['missing "id"'], warnings: [] },
      { row_number: 3, source_row: { name: "Clean row" }, errors: [], warnings: [] },
    ]);
    expect(csv).toContain('"{\"\"name\"\":\"\"Doe, Jane\"\"}"');
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).not.toContain("Clean row");
  });
});
