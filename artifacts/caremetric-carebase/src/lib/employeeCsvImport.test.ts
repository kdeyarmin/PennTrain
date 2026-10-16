import { describe, expect, it } from "vitest";
import { employeeImportTemplate, previewEmployeeCsv } from "./employeeCsvImport";
import { parseCsv } from "./csv";

const facilities = ["Sunrise Manor", "Maple Grove"];

describe("staff spreadsheet preview", () => {
  it("downloads a template whose example row matches a real facility name", () => {
    const csv = employeeImportTemplate("Sunrise Manor, LLC");
    const parsed = parseCsv(csv);
    expect(parsed.headers.slice(0, 4)).toEqual(["first_name", "last_name", "job_title", "facility_name"]);
    expect(parsed.rows).toEqual([[
      "Avery", "Chen", "Caregiver", "Sunrise Manor, LLC", "avery.chen@example.com",
      "717-555-0100", "E-100", "Direct care", "2026-01-15", "active", "false", "false",
    ]]);
    expect(previewEmployeeCsv(csv, ["Sunrise Manor, LLC"]).validCount).toBe(1);
  });

  it("rejects a file that is missing the columns a new customer must fill in", () => {
    const preview = previewEmployeeCsv("email,phone\na@example.com,717", facilities);
    expect(preview.headerErrors.join(" ")).toMatch(/first_name/);
    expect(preview.headerErrors.join(" ")).toMatch(/facility_name/);
    expect(preview.rows).toEqual([]);
  });

  it("previews each row and names the location that does not match", () => {
    const csv = [
      "first_name,last_name,job_title,facility_name,email,hire_date,status",
      "Avery,Chen,Caregiver,Sunrise Manor,avery.chen@example.com,2026-01-15,Active",
      ",Lopez,Cook,Other House,not-an-email,January 2,retired",
    ].join("\n");
    const preview = previewEmployeeCsv(csv, facilities);
    expect(preview.validCount).toBe(1);
    expect(preview.invalidCount).toBe(1);
    expect(preview.rows[0].errors).toEqual([]);
    expect(preview.rows[1].errors.join(" ")).toMatch(/First name/);
    expect(preview.rows[1].errors.join(" ")).toMatch(/Other House/);
    expect(preview.rows[1].errors.join(" ")).toMatch(/Email/);
    expect(preview.rows[1].errors.join(" ")).toMatch(/Hire date/);
    expect(preview.rows[1].errors.join(" ")).toMatch(/Status/);
  });

  it("accepts an empty email and a status written with a space", () => {
    const csv = "first_name,last_name,job_title,facility_name,status\nAvery,Chen,Caregiver,sunrise manor,On Leave\n";
    const preview = previewEmployeeCsv(csv, facilities);
    expect(preview.headerErrors).toEqual([]);
    expect(preview.validCount).toBe(1);
    expect(preview.rows[0].errors).toEqual([]);
  });
});
