import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mutation: vi.fn(), invoke: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useMutation: h.mutation }));
vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke: h.invoke } } }));
import { useSignupOrganization } from "./useSignup";

const payload = {
  email: "admin@example.test", firstName: "Facility", lastName: "Administrator", organizationName: "New facility",
  legalAccepted: true, turnstileToken: "proof", redirectTo: "https://cmcarebase.com/reset-password",
  serviceAgreementVersion: "agreement-version", baaVersion: "baa-version",
};
function mutation() { useSignupOrganization(); return h.mutation.mock.calls.at(-1)![0].mutationFn; }
beforeEach(() => { vi.clearAllMocks(); h.invoke.mockResolvedValue({ data: { success: true }, error: null }); });

describe("signup license selection", () => {
  it.each([undefined, null, "", "ALF", "NH", "pch"])("refuses missing or unsupported selection %s before signup", async facilityType => {
    await expect(mutation()({ ...payload, facilityType })).rejects.toThrow("Select Personal Care Home (PCH) or Assisted Living Facility (ALF)");
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it.each(["PCH", "ALR"])("sends the explicit %s selection without changing the stored code", async facilityType => {
    await mutation()({ ...payload, facilityType });
    expect(h.invoke).toHaveBeenCalledWith("signup-organization", expect.objectContaining({ body: expect.objectContaining({ facility_type: facilityType }) }));
  });
});
