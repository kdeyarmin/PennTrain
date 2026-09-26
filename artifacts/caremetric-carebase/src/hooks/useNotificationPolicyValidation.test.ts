import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ mutation: vi.fn(), rpc: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useMutation: h.mutation, useQuery: vi.fn(), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
import { useSetNotificationChannelPolicy, useSetNotificationSpendPolicy } from "./useAdminNotificationDeliveries";
beforeEach(() => { vi.clearAllMocks(); h.rpc.mockResolvedValue({ data: null, error: null }); });
const spend = { organizationId: "org", monthlyBudgetUsd: 100, emailEstimateUsd: 0.001, smsEstimateUsd: 0.02, warningPercent: 80 };
describe("notification policy values at the RPC boundary", () => {
  it.each([
    { monthlyBudgetUsd: NaN }, { monthlyBudgetUsd: Infinity }, { monthlyBudgetUsd: -1 }, { monthlyBudgetUsd: 0 },
    { emailEstimateUsd: Infinity }, { smsEstimateUsd: NaN }, { smsEstimateUsd: -1 }, { monthlyBudgetUsd: 1e20 },
    { warningPercent: NaN }, { warningPercent: 1.5 }, { warningPercent: 0 }, { warningPercent: 100 },
  ])("rejects invalid spend values %o before JSON can turn them into null", async invalid => {
    useSetNotificationSpendPolicy();
    await expect(h.mutation.mock.calls[0][0].mutationFn({ ...spend, ...invalid })).rejects.toThrow("Enter a positive monthly budget");
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("preserves explicit unlimited budget and valid zero estimates", async () => {
    useSetNotificationSpendPolicy();
    await h.mutation.mock.calls[0][0].mutationFn({ ...spend, monthlyBudgetUsd: null, emailEstimateUsd: 0 });
    expect(h.rpc).toHaveBeenCalledWith("set_notification_spend_policy", {
      p_organization_id: "org", p_monthly_budget_usd: null, p_email_estimate_usd: 0, p_sms_estimate_usd: 0.02, p_warning_percent: 80,
    });
  });
  it.each([
    { fallbackDelayMinutes: NaN }, { fallbackDelayMinutes: Infinity }, { fallbackDelayMinutes: 1.5 },
    { fallbackDelayMinutes: -1 }, { fallbackDelayMinutes: 1441 }, { maxFallbackDepth: 0.5 }, { maxFallbackDepth: 3 },
  ])("rejects invalid fallback values %o", async invalid => {
    useSetNotificationChannelPolicy();
    await expect(h.mutation.mock.calls[0][0].mutationFn({ organizationId: "org", fallbackEnabled: true, fallbackDelayMinutes: 30, maxFallbackDepth: 2, ...invalid })).rejects.toThrow("whole fallback delay");
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("permits disabling fallback with zero delay and depth", async () => {
    useSetNotificationChannelPolicy();
    await h.mutation.mock.calls[0][0].mutationFn({ organizationId: "org", fallbackEnabled: false, fallbackDelayMinutes: 0, maxFallbackDepth: 0 });
    expect(h.rpc).toHaveBeenCalledWith("set_notification_channel_policy", {
      p_organization_id: "org", p_fallback_enabled: false, p_fallback_delay_minutes: 0, p_max_fallback_depth: 0,
    });
  });
});
