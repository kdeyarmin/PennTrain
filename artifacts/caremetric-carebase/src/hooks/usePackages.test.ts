import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(), from: vi.fn(), accountSelect: vi.fn(), accountEq: vi.fn(),
  accountMaybeSingle: vi.fn(), rpc: vi.fn(), subscriptionMaybeSingle: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery, useMutation: vi.fn(), useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/hooks/useOrganizations", () => ({
  useListOrganizations: () => ({ data: [] }),
  useGetOrganization: () => ({ data: { id: "org", name: "Organization", package_id: "train", trial_ends_at: null } }),
}));
vi.mock("@/hooks/useEnterpriseFoundation", () => ({ useCreateBillingSession: () => ({ isPending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useOrganizationBillingAccount } from "./usePackages";
import { BillingPlanSelector } from "@/components/billing/BillingPlanSelector";

const account = { id: "account", billing_state: "active", stripe_customer_id: "cus_existing" };
const subscription = {
  id: "subscription", organization_id: "org", billing_account_id: account.id,
  stripe_subscription_id: "sub_existing", package_id: "train",
  billing_state: "suspended", provider_status: "paused", is_provider_placeholder: false,
  provider_event_id: "evt_pause", provider_event_created_at: "2026-09-09T10:00:00Z",
  current_period_end: "2099-10-01T00:00:00Z", cancel_at_period_end: true,
  quantity_sync_checked_at: null, quantity_sync_status: "synced", quantity_sync_error_code: null,
};
const query = (data: unknown, error: Error | null = null) => ({ data, error, isLoading: false });
let billingQuery = query(undefined);

function options(organizationId: string | undefined = "org") {
  useOrganizationBillingAccount(organizationId);
  return mocks.useQuery.mock.calls.at(-1)![0];
}

function renderBilling(data: unknown, error: Error | null = null) {
  billingQuery = query(data, error);
  return renderToStaticMarkup(createElement(BillingPlanSelector));
}

beforeEach(() => {
  vi.resetAllMocks();
  billingQuery = query(undefined);
  mocks.from.mockReturnValue({ select: mocks.accountSelect });
  mocks.accountSelect.mockReturnValue({ eq: mocks.accountEq });
  mocks.accountEq.mockReturnValue({ maybeSingle: mocks.accountMaybeSingle });
  mocks.accountMaybeSingle.mockResolvedValue({ data: account, error: null });
  mocks.rpc.mockReturnValue({ maybeSingle: mocks.subscriptionMaybeSingle });
  mocks.subscriptionMaybeSingle.mockResolvedValue({ data: subscription, error: null });
  mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    switch (queryKey[0]) {
      case "organization-billing-account": return billingQuery;
      case "packages": return query([{
        id: "train", name: "Train", is_active: true, contact_sales: false,
        features: {}, trial_days: 14, annual_discount_percent: 0,
      }]);
      case "package-billing-prices": return query([{
        id: "price", package_id: "train", stripe_price_id: "price_train",
        is_active: true, is_primary: true, effective_from: "2020-01-01T00:00:00Z", effective_to: null,
        recurring_interval: "month", billing_metric: "flat", pricing_model: "flat",
        base_amount_cents: 23900, currency: "usd", included_quantity: 0,
        unit_amount_cents: null, minimum_quantity: 1, maximum_quantity: null,
      }]);
      case "organization-billing-usage": return query({ activeLearners: 1, activeUsers: 1, activeResidents: 0, facilities: 1 });
      default: throw new Error(`Unexpected query: ${String(queryKey[0])}`);
    }
  });
});

describe("managed billing subscription selection", () => {
  it.each(["paused", "unpaid"])("keeps a payment-backed %s subscription in the billing portal without rewriting provider state", async (providerStatus) => {
    const selected = { ...subscription, provider_status: providerStatus };
    mocks.subscriptionMaybeSingle.mockResolvedValue({ data: selected, error: null });
    const selectedOptions = options();
    expect(selectedOptions.queryKey).toEqual(["organization-billing-account", "org"]);
    const result = await selectedOptions.queryFn();
    expect(result).toEqual({ account, subscription: selected });
    expect(result.subscription).toBe(selected);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_managed_billing_subscriptions", {
      p_organization_id: "org", p_limit: 1, p_for_quantity_sync: false,
    });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("billing_accounts");
    expect(mocks.accountEq).toHaveBeenCalledExactlyOnceWith("organization_id", "org");

    const html = renderBilling(result);
    expect(html).toContain("Change in billing portal");
    expect(html).toContain("Current plan");
    expect(html).toContain("Cancels at period end");
    expect(html).not.toContain("Start secure checkout");
  });

  it("keeps past-due subscriptions available for management", async () => {
    const pastDue = { ...subscription, billing_state: "past_due", provider_status: "past_due" };
    mocks.subscriptionMaybeSingle.mockResolvedValue({ data: pastDue, error: null });
    const result = await options().queryFn();
    expect(result.subscription).toBe(pastDue);
    const html = renderBilling(result);
    expect(html).toContain("Change in billing portal");
    expect(html).not.toContain("Start secure checkout");
  });

  it("allows checkout when the authoritative lookup confirms no managed subscription", async () => {
    mocks.subscriptionMaybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await options().queryFn();
    expect(result).toEqual({ account, subscription: null });
    const html = renderBilling(result);
    expect(html).toContain("Start secure checkout");
    expect(html).not.toContain("Change in billing portal");
  });

  it.each(["subscription", "account"])("propagates a failed %s lookup and hides checkout instead of presenting no subscription", async (failedLookup) => {
    const error = new Error("Billing lookup unavailable");
    const failed = failedLookup === "subscription" ? mocks.subscriptionMaybeSingle : mocks.accountMaybeSingle;
    failed.mockResolvedValue({ data: null, error });
    await expect(options().queryFn()).rejects.toBe(error);
    const html = renderBilling(undefined, error);
    expect(html).toContain("Billing account could not be loaded");
    expect(html).not.toContain("Start secure checkout");
    expect(html).not.toContain("Change in billing portal");
  });

  it("does not enable the query until an organization is selected", () => {
    useOrganizationBillingAccount(undefined);
    const selectedOptions = mocks.useQuery.mock.calls.at(-1)![0];
    expect(selectedOptions.queryKey).toEqual(["organization-billing-account", undefined]);
    expect(selectedOptions.enabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
