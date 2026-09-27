import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_STAFF_POLICY } from "@/hooks/useStaffRegulatory";
import { StaffRegulatoryPolicy } from "./StaffRegulatoryPolicy";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "facility_manager" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useStaffRegulatory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useStaffRegulatory")>();
  return { ...actual, useStaffRegulatoryPolicy: () => ({ data: actual.DEFAULT_STAFF_POLICY }),
    useSaveStaffRegulatorySettings: () => ({ isPending: false, mutateAsync: vi.fn() }) };
});

describe("license-specific staff policy", () => {
  it("starts without a voluntary clearance recurrence or extra PCH prerequisites", () => {
    expect(DEFAULT_STAFF_POLICY.clearance_renewal_years).toBeNull();
    expect(DEFAULT_STAFF_POLICY.pch_cpr_before_care).toBe(false);
    expect(DEFAULT_STAFF_POLICY.pch_dementia_30day).toBe(false);
    expect(DEFAULT_STAFF_POLICY.alf_transfer_months).toBe(12);
    expect(DEFAULT_STAFF_POLICY.annual_grace_days).toBe(15);
  });
  it("only shows PCH chapter controls at a personal care home", () => {
    const page = renderToStaticMarkup(<StaffRegulatoryPolicy facilityId="pch" facilityType="PCH" />);
    expect(page).toContain("PCH · Chapter 2600");
    expect(page).toContain("Require CPR/first aid before PCH care as facility policy");
    expect(page).toContain("Require PCH dementia training within 30 days as facility policy");
    expect(page).not.toContain("ALF initial-training transfer months");
    expect(page).not.toContain("Allow ALF general annual OJT credit");
    expect(page).toContain("up to six hours of on-the-job training");
  });
  it("only shows ALF chapter controls and the one-year initial transfer limit", () => {
    const page = renderToStaticMarkup(<StaffRegulatoryPolicy facilityId="alf" facilityType="ALR" />);
    expect(page).toContain("ALF · Chapter 2800");
    expect(page).toContain("ALF initial-training transfer months");
    expect(page).toContain("2800.65(k)");
    expect(page).not.toContain("RCG no limit");
    expect(page).not.toContain("Require CPR/first aid before PCH care");
    expect(page).not.toContain("Require PCH dementia training within 30 days");
    expect(page).toContain("Saved facility policies may be stricter");
  });
});
