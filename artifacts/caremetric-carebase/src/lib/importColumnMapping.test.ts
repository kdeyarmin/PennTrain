import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { importColumns } from "./dataImportCenter";
import {
  applyColumnMapping,
  headersMatchCanonical,
  mappedCellValue,
  missingRequiredColumns,
  suggestColumnMapping,
  type ColumnMapping,
} from "./importColumnMapping";

describe("headersMatchCanonical", () => {
  it("accepts the canonical header row in canonical order", () => {
    expect(headersMatchCanonical([...importColumns("residents")], "residents")).toBe(true);
  });

  it("accepts the canonical columns reordered, since the active processors key rows by header name", () => {
    const reordered = [...importColumns("residents")].reverse();
    expect(headersMatchCanonical(reordered, "residents")).toBe(true);
  });

  it("rejects a case-sensitive rename, matching the processors' literal `column in rows[0]` check", () => {
    const renamed = importColumns("residents").map((c) => (c === "first_name" ? "First_Name" : c));
    expect(headersMatchCanonical(renamed, "residents")).toBe(false);
  });

  it("rejects a missing canonical column and an extra unrecognized column", () => {
    const missing = importColumns("rooms").filter((c) => c !== "unit");
    expect(headersMatchCanonical(missing, "rooms")).toBe(false);
    expect(headersMatchCanonical([...importColumns("rooms"), "notes"], "rooms")).toBe(false);
  });

  it("rejects a duplicated header name even if the canonical set is otherwise present", () => {
    const withDuplicate = ["facility", "room_number", "room_number", "capacity", "status"];
    expect(headersMatchCanonical(withDuplicate, "rooms")).toBe(false);
  });
});

describe("suggestColumnMapping", () => {
  it("auto-matches renamed, case-different, and reordered residents headers", () => {
    const uploadedHeaders = ["External Id", "First Name", "Last Name", "DOB", "Facility", "Room"];
    const mapping = suggestColumnMapping(uploadedHeaders, "residents");
    expect(mapping).toEqual({
      external_id: 0,
      first_name: 1,
      last_name: 2,
      date_of_birth: 3, // via the DOB alias, not a normalized/exact match
      facility: 4,
      room: 5,
    });
  });

  it("auto-matches rooms headers through substring containment and the room-number alias", () => {
    const uploadedHeaders = ["Facility Name", "Room No", "Unit Name", "Capacity", "Status"];
    const mapping = suggestColumnMapping(uploadedHeaders, "rooms");
    expect(mapping).toEqual({
      facility: 0,
      room_number: 1,
      unit: 2,
      capacity: 3,
      status: 4,
    });
  });

  it("never assigns the same uploaded column to two canonical fields", () => {
    // "status" appears verbatim once; nothing else in this header set should be able to steal it.
    const uploadedHeaders = ["Employee Number", "First Name", "Last Name", "Job Title", "Facility Name", "Status"];
    const mapping = suggestColumnMapping(uploadedHeaders, "employees");
    const assignedIndexes = Object.values(mapping).filter((index): index is number => index !== null);
    expect(new Set(assignedIndexes).size).toBe(assignedIndexes.length);
    expect(mapping.status).toBe(5);
  });

  it("leaves a canonical field null when nothing in the file plausibly supplies it", () => {
    const mapping = suggestColumnMapping(["first_name", "last_name", "facility"], "residents");
    expect(mapping.date_of_birth).toBeNull();
    expect(mapping.room).toBeNull();
    expect(mapping.external_id).toBeNull();
  });
});

describe("missingRequiredColumns", () => {
  it("flags required employees fields left unmapped", () => {
    const mapping: ColumnMapping = { first_name: 0, last_name: 1, job_title: null, facility_name: null, email: null };
    expect(missingRequiredColumns("employees", mapping)).toEqual(["job_title", "facility_name"]);
  });

  it("returns no gaps once every required field is mapped", () => {
    const mapping: ColumnMapping = { first_name: 0, last_name: 1, job_title: 2, facility_name: 3 };
    expect(missingRequiredColumns("employees", mapping)).toEqual([]);
  });
});

describe("mappedCellValue / applyColumnMapping", () => {
  it("reads a mapped cell by index and treats an unmapped field as blank", () => {
    const mapping: ColumnMapping = { a: 1, b: null };
    expect(mappedCellValue(["x", "y"], mapping, "a")).toBe("y");
    expect(mappedCellValue(["x", "y"], mapping, "b")).toBe("");
  });

  it("renders a full canonical header row, in canonical order, regardless of upload order", () => {
    // Uploaded order: last_name, first_name, facility, room -- reversed/interleaved vs. canonical.
    const mapping: ColumnMapping = { external_id: null, first_name: 1, last_name: 0, date_of_birth: null, facility: 2, room: 3 };
    const csv = applyColumnMapping("residents", [["Doe", "Jane", "Sunrise House", "12A"]], mapping);
    const [headerLine, dataLine] = csv.trim().split("\n");
    expect(headerLine).toBe(importColumns("residents").join(","));
    expect(dataLine).toBe(",Jane,Doe,,Sunrise House,12A");
  });

  it("escapes commas and quotes in mapped values so the pipeline still parses them as one field", () => {
    const mapping: ColumnMapping = { facility: 0, room_number: 1, unit: null, capacity: null, status: null };
    const csv = applyColumnMapping("rooms", [['Sunrise House, LLC', '12"A']], mapping);
    const reparsed = parseCsv(csv);
    expect(reparsed.headers).toEqual([...importColumns("rooms")]);
    expect(reparsed.rows[0][0]).toBe("Sunrise House, LLC");
    expect(reparsed.rows[0][1]).toBe('12"A');
  });

  it("round-trips a renamed/reordered upload through suggest + apply back to canonical headers and original values", () => {
    const sourceCsv = [
      "Facility Name,Room No,Unit Name,Capacity,Status",
      'Sunrise House,101,"Maple, East",2,available',
    ].join("\n");
    const parsed = parseCsv(sourceCsv);
    const mapping = suggestColumnMapping(parsed.headers, "rooms");
    const mappedCsv = applyColumnMapping("rooms", parsed.rows, mapping);
    const reparsed = parseCsv(mappedCsv);
    expect(reparsed.headers).toEqual([...importColumns("rooms")]);
    expect(reparsed.rows).toEqual([["Sunrise House", "101", "Maple, East", "2", "available"]]);
  });
});
