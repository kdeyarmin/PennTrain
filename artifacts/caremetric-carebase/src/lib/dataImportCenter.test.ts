import { describe, expect, it } from "vitest";
import { IMPORT_DOMAIN_DEFINITIONS, IMPORT_DOMAINS, canUploadImportDomain, importTemplate, rowsToErrorCsv } from "./dataImportCenter";

describe("data import center", () => {
  it("offers a versionable CSV template for every supported domain", () => {
    expect(IMPORT_DOMAINS).toHaveLength(8);
    for (const domain of IMPORT_DOMAINS) expect(importTemplate(domain)).toMatch(/.+,.+\n$/);
  });

  it("does not confuse template availability with an active processor", () => {
    expect(IMPORT_DOMAIN_DEFINITIONS).toHaveLength(IMPORT_DOMAINS.length);
    expect(IMPORT_DOMAIN_DEFINITIONS.filter(({ availability }) => availability === "active").map(({ domain }) => domain)).toEqual(["employees"]);
    expect(canUploadImportDomain("employees")).toBe(true);
    expect(canUploadImportDomain("incidents")).toBe(false);
  });

  it("exports row diagnostics without allowing commas or quotes to corrupt the CSV", () => {
    const csv = rowsToErrorCsv([
      { row_number: 2, source_row: { name: "Doe, Jane" }, errors: ["missing \"id\""], warnings: [] },
      { row_number: 3, source_row: { name: "Clean row" }, errors: [], warnings: [] },
    ]);
    expect(csv).toContain('"{\"\"name\"\":\"\"Doe, Jane\"\"}"');
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).not.toContain("Clean row");
  });
});
