import { describe, expect, it } from "vitest";
import { officialContactEditStart } from "./residentOfficialContacts";

describe("officialContactEditStart", () => {
  const contacts = [
    { id: "c1", contact_type: "emergency_contact", name: "Dana Reyes" },
    { id: "c2", contact_type: "power_of_attorney", name: "Sam Reyes" },
  ];

  it("refuses while the master query has not answered", () => {
    // The whole point: "no contacts on file" and "not loaded / failed" must not look the same.
    // save_resident_administrative_master deactivates every active contact and re-activates only
    // what it is sent, so an edit that starts from [] deactivates the resident's real contacts.
    expect(officialContactEditStart(false, undefined)).toEqual({ canEdit: false });
    expect(officialContactEditStart(false, contacts)).toEqual({ canEdit: false });
    expect(officialContactEditStart(true, undefined)).toEqual({ canEdit: false });
  });

  it("hands back the set to replace once the answer is in", () => {
    expect(officialContactEditStart(true, contacts)).toEqual({ canEdit: true, contacts });
  });

  it("permits a genuinely empty set only when that is the answer", () => {
    expect(officialContactEditStart(true, [])).toEqual({ canEdit: true, contacts: [] });
  });

  it("copies rather than aliases, so a refetch cannot change what the save replaces", () => {
    const live = [{ id: "c1", contact_type: "emergency_contact", name: "Dana Reyes" }];
    const start = officialContactEditStart(true, live);
    expect(start.canEdit).toBe(true);
    if (!start.canEdit) return;
    live[0].name = "overwritten by a background refetch";
    expect(start.contacts[0].name).toBe("Dana Reyes");
    expect(start.contacts[0]).not.toBe(live[0]);
  });
});
