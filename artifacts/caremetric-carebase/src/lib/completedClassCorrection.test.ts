import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORRECTABLE_CLASS_FIELDS,
  CORRECTION_REASON_MIN_LENGTH,
  correctionReasonIssue,
  unacceptableClassPatchFields,
} from "./completedClassCorrection";

const MIGRATION = join(
  __dirname, "..", "..", "..", "..",
  "supabase/migrations/20260714233041_remediate_p2_security_findings.sql",
);

describe("rules pinned to the migration", () => {
  // These constants exist so a form can say what is wrong before submitting. If they drift from the
  // server the form starts lying -- either refusing what the server would accept, or accepting what
  // it will reject. Both are read out of the SQL rather than trusted.
  const sql = readFileSync(MIGRATION, "utf8");

  it("uses the same minimum reason length the RPCs enforce", () => {
    const guards = [...sql.matchAll(/length\(btrim\(coalesce\(p_reason, ''\)\)\) < (\d+)/g)]
      .map((match) => Number(match[1]));
    expect(guards.length, "reason guards not found in the migration").toBeGreaterThanOrEqual(2);
    for (const guard of guards) expect(guard).toBe(CORRECTION_REASON_MIN_LENGTH);
  });

  it("offers exactly the fields the class-correction RPC will accept", () => {
    // The RPC refuses the whole call if the patch carries anything outside this list, so a field
    // offered here that is not there makes every correction fail.
    const start = sql.indexOf("p_patch - array[");
    expect(start, "patch allow-list not found").toBeGreaterThan(-1);
    const block = sql.slice(start, sql.indexOf("]", start));
    const allowed = [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(allowed.sort()).toEqual([...CORRECTABLE_CLASS_FIELDS].sort());
  });
});

describe("correction reason", () => {
  it("requires a reason at all, and says why it is kept", () => {
    const issue = correctionReasonIssue("   ");
    expect(issue).toContain("required");
    expect(issue).toContain("permanently");
  });

  it("refuses a reason shorter than the server will take", () => {
    expect(correctionReasonIssue("typo")).toContain(String(CORRECTION_REASON_MIN_LENGTH));
  });

  it("accepts a reason exactly at the boundary", () => {
    // The server's guard is `< 10`, so ten characters is acceptable and nine is not.
    expect(correctionReasonIssue("a".repeat(CORRECTION_REASON_MIN_LENGTH))).toBeNull();
    expect(correctionReasonIssue("a".repeat(CORRECTION_REASON_MIN_LENGTH - 1))).not.toBeNull();
  });

  it("measures the trimmed reason, as the server does", () => {
    expect(correctionReasonIssue(`   ${"a".repeat(9)}   `)).not.toBeNull();
  });
});

describe("patch fields", () => {
  it("accepts a patch of only correctable fields", () => {
    expect(unacceptableClassPatchFields({ class_name: "x", notes: "y" })).toEqual([]);
  });

  it("names the offending fields rather than failing generically", () => {
    // scheduled_hours is the sharp one: the training record was computed from it, so patching it
    // would desynchronise the record from the class it came from.
    expect(unacceptableClassPatchFields({ class_name: "x", scheduled_hours: 2, class_date: "2026-01-01" }))
      .toEqual(["scheduled_hours", "class_date"]);
  });

  it("treats an empty patch as acceptable", () => {
    expect(unacceptableClassPatchFields({})).toEqual([]);
  });
});
