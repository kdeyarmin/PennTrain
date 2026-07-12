import { describe, expect, it } from "vitest";
import { assertOfflinePayloadAllowed, decryptOfflinePayload, encryptOfflinePayload, generateOfflineDeviceKey, shouldWipeOfflineData } from "./offlineLearning";

const payload = { domain: "course_block" as const, organizationId: "org-1", profileId: "user-1", versionId: "v1", data: { title: "Safe lesson", body: "Learner content" } };
describe("offline learning safety", () => {
  it("accepts only scoped learner content", () => expect(() => assertOfflinePayloadAllowed(payload)).not.toThrow());
  it("rejects protected domains nested in content", () => expect(() => assertOfflinePayloadAllowed({ ...payload, data: { resident: { name: "No" } } })).toThrow(/protected/));
  it("encrypts content with user and tenant scope", async () => { const key = await generateOfflineDeviceKey(); const encrypted = await encryptOfflinePayload(key, payload); await expect(decryptOfflinePayload(key, encrypted, "org-1:user-1:v1")).resolves.toEqual(payload); await expect(decryptOfflinePayload(key, encrypted, "org-2:user-1:v1")).rejects.toThrow(/wipe required/); });
  it("requires wipe after logout, role, user, tenant, or active-state change", () => { const prior = { profileId: "u1", organizationId: "o1", role: "employee" }; expect(shouldWipeOfflineData(prior, null)).toBe(true); expect(shouldWipeOfflineData(prior, { ...prior, role: "trainer", active: true })).toBe(true); expect(shouldWipeOfflineData(prior, { ...prior, active: true })).toBe(false); });
});
