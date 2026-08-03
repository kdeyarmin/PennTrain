import { describe, expect, it } from "vitest";
import { signedInIdentityChanged, type SessionIdentity } from "./sessionIdentity";
import { shouldWipeOfflineServiceDraftData } from "./offlineServiceDraftSafety";

const aide: SessionIdentity = { profileId: "p1", organizationId: "org1", role: "employee" };
const manager: SessionIdentity = { profileId: "p2", organizationId: "org1", role: "facility_manager" };

describe("signedInIdentityChanged (BACKLOG.md open question 6)", () => {
  it("does not treat first resolution as a change", () => {
    // SIGNED_IN already cleared; there is nothing populated under a previous identity.
    expect(signedInIdentityChanged(null, aide)).toBe(false);
  });

  it("is quiet when the same identity resolves again", () => {
    expect(signedInIdentityChanged(aide, { ...aide })).toBe(false);
  });

  // The case the whole thing exists for: an admin changes someone's role or facility mid-shift and
  // the session stays signed in, so no sign-out path fires and nothing clears the cache.
  it("fires when a role changes under a surviving session", () => {
    expect(signedInIdentityChanged(aide, { ...aide, role: "facility_manager" })).toBe(true);
  });

  it("fires when the organization changes under a surviving session", () => {
    expect(signedInIdentityChanged(aide, { ...aide, organizationId: "org2" })).toBe(true);
  });

  it("fires when the profile itself changes", () => {
    expect(signedInIdentityChanged(aide, manager)).toBe(true);
  });

  it("fires when an established identity is lost", () => {
    expect(signedInIdentityChanged(aide, null)).toBe(true);
  });

  it("stays quiet when there was never an identity to lose", () => {
    expect(signedInIdentityChanged(null, null)).toBe(false);
  });
});

// The reason this predicate exists at all rather than reusing the offline-store one. If the cache
// clear were hooked to shouldWipeOfflineServiceDraftData, every manager would lose their entire
// react-query cache on every identity evaluation, because that predicate treats any non-employee
// role as "wipe" by design -- correct for an employee-only draft store, catastrophic for a cache.
describe("it is deliberately not the offline-draft wipe predicate", () => {
  it("the offline predicate wipes for an unchanged manager; this one does not", () => {
    const unchangedManager = { ...manager, active: true };
    expect(shouldWipeOfflineServiceDraftData(manager, unchangedManager)).toBe(true);
    expect(signedInIdentityChanged(manager, manager)).toBe(false);
  });

  it("and both agree that a genuine identity change is one", () => {
    const movedOrg = { ...aide, organizationId: "org2", active: true };
    expect(shouldWipeOfflineServiceDraftData(aide, movedOrg)).toBe(true);
    expect(signedInIdentityChanged(aide, movedOrg)).toBe(true);
  });
});
