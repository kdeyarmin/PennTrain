import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Read as source rather than imported: the dialog module pulls in useAdmissions, which pulls in
// the Supabase client, which throws without VITE_SUPABASE_URL. This file is about the text of the
// contract anyway.

const DIALOG = join(__dirname, "ResidentCensusStatusDialog.tsx");
const JOURNEY = join(__dirname, "..", "..", "..", "e2e", "resident-lifecycle.spec.ts");

/**
 * The accessible names the resident-lifecycle journey drives to discharge a resident.
 *
 * This file exists because of what happened on 2026-09-06. The header's two-option "Resident
 * status" Select was replaced by this dialog -- a real fix, because writing `residents.status`
 * directly left the discharged resident holding their bed -- and nothing noticed that step 12 of
 * the journey still clicked a combobox that no longer existed. The suite stayed green: 1,863 unit
 * tests, 178 pgTAP files and every static gate pass without a browser, and the failure only
 * surfaced nine minutes into CI's Playwright job, twice, once per retry.
 *
 * So the contract is pinned here, where it costs milliseconds. Renaming a control in the dialog is
 * fine; renaming it without retargeting the journey is what this refuses.
 */
const DRIVEN_NAMES = [
  "Change status", // the button on the resident header that opens the dialog
  "Change resident status", // the dialog's own title, which scopes every locator below it
  "New resident status", // the target-state combobox
  "Record status change", // the submit button
];

describe("the census dialog and the journey that drives it", () => {
  const dialog = readFileSync(DIALOG, "utf8");
  const journey = readFileSync(JOURNEY, "utf8");

  it.each(DRIVEN_NAMES)("the journey drives \"%s\"", (name) => {
    expect(journey).toContain(name);
  });

  it("and every one of those names is still in the dialog or the header that opens it", () => {
    // "Change status" lives on ResidentDetail; the rest are the dialog's own.
    const header = readFileSync(join(__dirname, "..", "..", "pages", "app", "ResidentDetail.tsx"), "utf8");
    for (const name of DRIVEN_NAMES) {
      expect(dialog.includes(name) || header.includes(name), `missing accessible name: ${name}`).toBe(true);
    }
  });

  it("offers the five states transition_resident_census accepts, and not reserved", () => {
    const declared = dialog.match(/CENSUS_TARGET_STATUSES = \[([^\]]+)\]/);
    expect(declared, "CENSUS_TARGET_STATUSES is no longer declared as a literal array").not.toBeNull();
    const states = [...declared![1].matchAll(/"([a-z_]+)"/g)].map((entry) => entry[1]);
    expect(states).toEqual(["active", "temporarily_out", "hospital_leave", "discharged", "deceased"]);
    expect(states).not.toContain("reserved");
  });

  it("holds the reason floor the RPC enforces", () => {
    // transition_resident_census raises 22023 on `length(btrim(coalesce(p_reason,''))) < 3`, so a
    // dialog that submitted a shorter one would only produce a raw "Invalid census transition".
    expect(dialog).toContain("CENSUS_REASON_MIN_LENGTH = 3");
    expect(dialog).toContain("reason.trim().length < CENSUS_REASON_MIN_LENGTH");
  });

  it("the journey's discharge reason clears that floor", () => {
    const match = journey.match(/getByLabel\("Reason"\)\.fill\("([^"]+)"\)/);
    expect(match, "the journey no longer fills the census reason").not.toBeNull();
    expect(match![1].trim().length).toBeGreaterThanOrEqual(3);
  });
});
