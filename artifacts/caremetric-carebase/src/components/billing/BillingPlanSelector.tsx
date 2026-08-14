import { useId, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { billingSessionFailureCopy, type BillingSessionErrorCopy } from "@/lib/billingErrors";
import { isLiveSubscriptionState, resolveTrialPresentation } from "@/lib/trialStatus";
import { cn } from "@/lib/utils";
import type { Json } from "@/lib/database.types";
import {
  billingMetricDefinition,
  billingPriceSummary,
  estimatedBillingAmountCents,
  formatBillingMoney,
  isFlatBillingPrice,
  measuredBillingQuantity,
  resolvedBillingQuantity,
  selectPrimaryBillingPrice,
} from "@/lib/billingCatalog";
import { PRODUCT_MODULES, withModuleDependencies } from "@/lib/productModules";
import {
  useListPackageBillingPrices,
  useListPackages,
  useOrganizationBillingAccount,
  useOrganizationBillingUsage,
  type Package,
  type PackageBillingPrice,
} from "@/hooks/usePackages";
import { useGetOrganization, useListOrganizations } from "@/hooks/useOrganizations";
import { useCreateBillingSession } from "@/hooks/useEnterpriseFoundation";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { absoluteAppUrl } from "@/lib/appUrl";

function enabledModuleNames(features: Json | null): string[] {
  if (!features || typeof features !== "object" || Array.isArray(features)) return [];
  const record = features as Record<string, Json | undefined>;
  const enabledIds = new Set(
    PRODUCT_MODULES.filter((module) => record[module.entitlementKey] === true).map((module) => module.id),
  );
  // CareBase is the all-inclusive bundle. Enumerate the included operational pillars for the plan
  // card's value list instead of the redundant bundle entry. The pillar set is derived from the
  // productModules dependency graph (the source of truth) so it cannot drift as modules are added.
  if (enabledIds.has("carebase")) {
    for (const moduleId of withModuleDependencies(["carebase"])) {
      if (moduleId !== "core" && moduleId !== "carebase") enabledIds.add(moduleId);
    }
    enabledIds.delete("carebase");
  }
  return PRODUCT_MODULES.filter((module) => enabledIds.has(module.id)).map((module) => module.name);
}

function subscriptionStateLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function billingFailureDescription(copy: BillingSessionErrorCopy) {
  if (!copy.actionPath) return copy.description;
  return (
    <span>
      {copy.description}{" "}
      <Link href={copy.actionPath} className="font-medium underline underline-offset-2">
        {copy.actionLabel ?? "Open Account Security"}
      </Link>
    </span>
  );
}

export function BillingPlanSelector() {
  const __fieldIds = useId();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const session = useCreateBillingSession();
  const isPlatformAdmin = user?.role === "platform_admin";
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const organizationId = isPlatformAdmin
    ? selectedOrganizationId
    : user?.organizationId ?? "";

  const organizationsQuery = useListOrganizations();
  const organizationQuery = useGetOrganization(organizationId || undefined);
  const packagesQuery = useListPackages();
  const pricesQuery = useListPackageBillingPrices();
  const usageQuery = useOrganizationBillingUsage(organizationId || undefined);
  const billingAccountQuery = useOrganizationBillingAccount(organizationId || undefined);

  const packages = useMemo(
    () => (packagesQuery.data ?? []).filter((pkg) => pkg.is_active),
    [packagesQuery.data],
  );
  const currentSubscription = billingAccountQuery.data?.subscription;
  const trialPresentation = useMemo(
    () => (organizationQuery.data && billingAccountQuery.data
      ? resolveTrialPresentation({
        trialEndsAt: organizationQuery.data.trial_ends_at,
        billingState: billingAccountQuery.data.account?.billing_state,
        hasLiveSubscription: isLiveSubscriptionState(billingAccountQuery.data.subscription?.billing_state),
      })
      : { kind: "none" as const }),
    [organizationQuery.data, billingAccountQuery.data],
  );
  const currentPackageId = currentSubscription?.package_id ?? organizationQuery.data?.package_id;
  const hasManagedSubscription = !!currentSubscription;
  const hasCustomerPortal = !!billingAccountQuery.data?.account?.stripe_customer_id;
  const usage = usageQuery.data;
  const catalogError = packagesQuery.error ?? pricesQuery.error ?? organizationQuery.error ?? billingAccountQuery.error;
  const catalogErrorLabel = packagesQuery.error
    ? "Plan catalog could not be loaded"
    : pricesQuery.error
    ? "Billing prices could not be loaded"
    : organizationQuery.error
    ? "Organization details could not be loaded"
    : billingAccountQuery.error
    ? "Billing account could not be loaded"
    : null;
  const isCatalogLoading = packagesQuery.isLoading || pricesQuery.isLoading || organizationQuery.isLoading || billingAccountQuery.isLoading;
  const busy = session.isPending;

  // Catalog is flat-first when every active primary price for the selected
  // cadence is flat (or there are no metered prices). Metered-era UX stays for
  // custom contracts if any active price still uses a usage metric.
  const catalogIsFlat = useMemo(() => {
    const prices = pricesQuery.data ?? [];
    const activePrimary = packages.flatMap((pkg) => {
      const price = selectPrimaryBillingPrice(prices, pkg.id, interval);
      return price && !pkg.contact_sales ? [price] : [];
    });
    if (activePrimary.length === 0) return true;
    return activePrimary.every(isFlatBillingPrice);
  }, [packages, pricesQuery.data, interval]);

  // Surface Stripe Checkout return status once, then scrub the query string.
  // After a successful checkout the webhook may still be in flight, so keep
  // refetching billing state for a short window until the stub/package land.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (billing !== "success" && billing !== "cancelled") return;
    if (billing === "success") {
      // Keep ?billing=success until the org is known so a slow profile load
      // does not scrub the flag before we can refetch.
      if (!organizationId) return;
      toast({
        title: "Checkout complete",
        description: "Stripe accepted the session. Subscription status will update when the webhook lands.",
      });
      const refreshBilling = () => {
        if (!organizationId) return;
        void queryClient.invalidateQueries({ queryKey: ["organization-billing-account", organizationId] });
        void queryClient.invalidateQueries({ queryKey: ["organizations", organizationId] });
      };
      refreshBilling();
      const interval = window.setInterval(refreshBilling, 2000);
      const timeout = window.setTimeout(() => window.clearInterval(interval), 16_000);
      params.delete("billing");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", next);
      return () => {
        window.clearInterval(interval);
        window.clearTimeout(timeout);
      };
    }
    toast({
      title: "Checkout cancelled",
      description: "No charge was made. You can start checkout again when you are ready.",
    });
    params.delete("billing");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);
    return undefined;
  }, [toast, queryClient, organizationId]);

  const openPortal = async () => {
    if (!organizationId) return;
    try {
      const result = await session.mutateAsync({
        organizationId,
        action: "portal",
        returnUrl: absoluteAppUrl(isPlatformAdmin ? "/admin/enterprise" : "/app/billing"),
        idempotencyKey: crypto.randomUUID(),
      });
      window.location.assign(result.data.url);
    } catch (error) {
      const copy = billingSessionFailureCopy(error, "Billing portal could not be opened");
      toast({
        title: copy.title,
        description: billingFailureDescription(copy),
        variant: "destructive",
      });
    }
  };

  const startCheckout = async (pkg: Package, price: PackageBillingPrice) => {
    if (!organizationId) return;
    const flat = isFlatBillingPrice(price);
    if (!flat && !usage) {
      toast({
        title: "Usage could not be measured",
        description: "Refresh and try again before starting checkout on a usage-based plan.",
        variant: "destructive",
      });
      return;
    }
    const quantity = flat
      ? 1
      : resolvedBillingQuantity(price.billing_metric, usage!, price.minimum_quantity);
    if (!flat && price.maximum_quantity !== null && quantity > price.maximum_quantity) {
      toast({
        title: "This organization needs contract pricing",
        description: `The measured quantity of ${quantity} exceeds this plan's self-service maximum.`,
        variant: "destructive",
      });
      return;
    }
    try {
      const returnPath = isPlatformAdmin ? "/admin/enterprise" : "/app/billing";
      const result = await session.mutateAsync({
        organizationId,
        action: "checkout",
        packageId: pkg.id,
        billingInterval: interval,
        successUrl: absoluteAppUrl(`${returnPath}?billing=success`),
        cancelUrl: absoluteAppUrl(`${returnPath}?billing=cancelled`),
        idempotencyKey: crypto.randomUUID(),
      });
      window.location.assign(result.data.url);
    } catch (error) {
      const copy = billingSessionFailureCopy(error, "Secure checkout could not be opened");
      toast({
        title: copy.title,
        description: billingFailureDescription(copy),
        variant: "destructive",
      });
    }
  };

  const showPlanCards = Boolean(organizationId && !catalogError && !isCatalogLoading);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Plans and subscription</CardTitle>
            <CardDescription className="mt-1">
              {catalogIsFlat
                ? "Self-serve plans are a flat monthly or annual fee. Roster size does not change the invoice."
                : "Usage-based plans measure the organization's current active records. Flat plans bill a fixed fee."}
            </CardDescription>
          </div>
          {hasCustomerPortal ? (
            <Button variant="outline" onClick={() => void openPortal()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <CreditCard />}
              Manage billing
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-5">
          {isPlatformAdmin ? (
            <div className="max-w-xl space-y-1.5">
              <Label htmlFor={`${__fieldIds}-organization`}>Organization</Label>
              <Select value={selectedOrganizationId} onValueChange={setSelectedOrganizationId}>
                <SelectTrigger id={`${__fieldIds}-organization`}><SelectValue placeholder="Select an organization" /></SelectTrigger>
                <SelectContent>
                  {(organizationsQuery.data ?? []).map((organization) => (
                    <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {!organizationId ? (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Select an organization</AlertTitle>
              <AlertDescription>Choose the tenant whose subscription you want to review.</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{organizationQuery.data?.name ?? "Organization"}</p>
                  {billingAccountQuery.data?.account?.billing_state ? (
                    <Badge variant="secondary">
                      {subscriptionStateLabel(billingAccountQuery.data.account.billing_state)}
                    </Badge>
                  ) : null}
                  {currentSubscription?.cancel_at_period_end ? <Badge variant="destructive">Cancels at period end</Badge> : null}
                  {currentSubscription?.quantity_sync_status === "synced" && !catalogIsFlat ? (
                    <Badge variant="outline">Quantity synchronized</Badge>
                  ) : null}
                  {currentSubscription?.quantity_sync_status === "synced" && catalogIsFlat ? (
                    <Badge variant="outline">Billing healthy</Badge>
                  ) : null}
                </div>
                <Tabs value={interval} onValueChange={(value) => setInterval(value as "month" | "year")}>
                  <TabsList>
                    <TabsTrigger value="month">Monthly</TabsTrigger>
                    <TabsTrigger value="year" className="gap-2">
                      Annual
                      <Badge variant="secondary" className="hidden sm:inline-flex">~2 months free</Badge>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {trialPresentation.kind === "trialing" ? (
                <Alert>
                  <CalendarClock className="h-4 w-4" />
                  <AlertTitle>
                    Trial ends {trialPresentation.endsAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}{" "}
                    ({trialPresentation.daysLeft} {trialPresentation.daysLeft === 1 ? "day" : "days"} left)
                  </AlertTitle>
                  <AlertDescription>
                    Choose a plan before the trial ends to keep uninterrupted access to your subscribed modules.
                  </AlertDescription>
                </Alert>
              ) : trialPresentation.kind === "ended" ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Trial ended — choose a plan to continue</AlertTitle>
                  <AlertDescription>
                    The free trial ended on {trialPresentation.endsAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.
                    Module access is paused until a plan is selected; starting secure checkout below restores it immediately.
                  </AlertDescription>
                </Alert>
              ) : null}

              {isCatalogLoading ? (
                <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading billing catalog…
                </div>
              ) : catalogError ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{catalogErrorLabel}</AlertTitle>
                  <AlertDescription>{catalogError.message}</AlertDescription>
                </Alert>
              ) : catalogIsFlat ? (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Flat self-serve pricing</p>
                  <p className="mt-1">
                    Train and CareBase bill a fixed fee. Adding learners, residents, or staff does not change the subscription price.
                  </p>
                </div>
              ) : usageQuery.isLoading ? (
                <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Measuring current billable usage…
                </div>
              ) : usage ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["Active learners", usage.activeLearners],
                    ["Active residents", usage.activeResidents],
                    ["Active users", usage.activeUsers],
                    ["Facilities", usage.facilities],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-xl font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <Alert variant="destructive">
                  <AlertTitle>Usage could not be measured</AlertTitle>
                  <AlertDescription>{usageQuery.error?.message ?? "Refresh and try again."}</AlertDescription>
                </Alert>
              )}
              {currentSubscription && ["unmapped", "out_of_range", "failed"].includes(currentSubscription.quantity_sync_status) ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Subscription quantity needs attention</AlertTitle>
                  <AlertDescription>
                    Status: {subscriptionStateLabel(currentSubscription.quantity_sync_status)}.
                    {currentSubscription.quantity_sync_error_code
                      ? ` ${currentSubscription.quantity_sync_error_code.replace(/_/g, " ")}.`
                      : ""}
                    {currentSubscription.quantity_sync_checked_at
                      ? ` Last checked ${new Date(currentSubscription.quantity_sync_checked_at).toLocaleString()}.`
                      : ""}
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {showPlanCards ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {packages.map((pkg) => {
            const price = selectPrimaryBillingPrice(pricesQuery.data ?? [], pkg.id, interval);
            const modules = enabledModuleNames(pkg.features);
            const metric = billingMetricDefinition(price?.billing_metric ?? "flat");
            const flat = isFlatBillingPrice(price);
            const measuredQuantity = price && usage && !flat
              ? measuredBillingQuantity(price.billing_metric, usage)
              : 1;
            const quantity = price
              ? flat
                ? 1
                : usage
                ? resolvedBillingQuantity(price.billing_metric, usage, price.minimum_quantity)
                : price.minimum_quantity
              : 1;
            const estimatedAmount = price ? estimatedBillingAmountCents(price, quantity) : null;
            const overMaximum = !flat && !!price?.maximum_quantity && quantity > price.maximum_quantity;
            const isCurrent = currentPackageId === pkg.id;
            const checkoutReady = !!price?.stripe_price_id && !overMaximum && (flat || !!usage);
            const cadenceDiscount = interval === "year" && pkg.annual_discount_percent > 0;

            return (
              <Card key={pkg.id} className={cn("relative flex flex-col", pkg.is_recommended && "border-primary shadow-sm")}>
                {pkg.is_recommended ? (
                  <Badge className="absolute -top-2.5 left-4 gap-1"><Sparkles className="h-3 w-3" /> Recommended</Badge>
                ) : null}
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{pkg.name}</CardTitle>
                    {isCurrent ? <Badge variant="outline">Current plan</Badge> : null}
                  </div>
                  <CardDescription>{pkg.description}</CardDescription>
                  <div className="pt-2">
                    <p className="text-2xl font-bold">
                      {pkg.contact_sales ? "Custom pricing" : price ? billingPriceSummary(price).split(" includes")[0] : "Not configured"}
                    </p>
                    {price && !pkg.contact_sales ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {flat ? `${billingPriceSummary(price)} · unlimited seats` : billingPriceSummary(price)}
                      </p>
                    ) : null}
                    {cadenceDiscount ? (
                      <Badge variant="secondary" className="mt-2">Save {pkg.annual_discount_percent}% annually</Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-5">
                  <div className="space-y-2">
                    {modules.map((module) => (
                      <div key={module} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 text-primary" />
                        <span>{module}</span>
                      </div>
                    ))}
                    {pkg.trial_days > 0 ? (
                      <div className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 text-primary" />
                        <span>{pkg.trial_days}-day trial for new subscriptions</span>
                      </div>
                    ) : null}
                  </div>

                  {price && !pkg.contact_sales ? (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                      {flat ? (
                        <>
                          <p className="font-medium">Flat subscription</p>
                          <p className="mt-1 text-muted-foreground">
                            One monthly (or annual) fee for the package — not charged per learner, resident, or staff user.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium">Automatic quantity: {quantity} {quantity === 1 ? metric.unit : `${metric.unit}s`}</p>
                          <p className="mt-1 text-muted-foreground">
                            {measuredQuantity} active now{quantity !== measuredQuantity ? `; ${price.minimum_quantity} minimum` : ""}.
                            {price.included_quantity > 0
                              ? ` ${price.included_quantity} included; ${Math.max(0, quantity - price.included_quantity)} overage.`
                              : ""}
                          </p>
                        </>
                      )}
                      {estimatedAmount !== null ? (
                        <p className="mt-2 font-medium">
                          Estimated recurring charge: {formatBillingMoney(estimatedAmount, price.currency)}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">Taxes and negotiated adjustments are not included in this estimate.</p>
                    </div>
                  ) : null}

                  <div className="mt-auto space-y-2">
                    {pkg.contact_sales || overMaximum ? (
                      <Button asChild className="w-full" variant={pkg.is_recommended ? "default" : "outline"}>
                        <Link href={isPlatformAdmin ? "/admin/packages" : "/app/help"}>
                          {isPlatformAdmin ? "Configure contract" : "Contact CareMetric"}
                        </Link>
                      </Button>
                    ) : hasManagedSubscription ? (
                      <Button className="w-full" onClick={() => void openPortal()} disabled={busy || !hasCustomerPortal}>
                        {busy ? <Loader2 className="animate-spin" /> : <CreditCard />}
                        Change in billing portal
                      </Button>
                    ) : checkoutReady && price ? (
                      <Button className="w-full" onClick={() => void startCheckout(pkg, price)} disabled={busy}>
                        {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                        Start secure checkout
                      </Button>
                    ) : isPlatformAdmin ? (
                      <Button asChild className="w-full" variant="outline">
                        <Link href="/admin/packages">Add Stripe Price ID</Link>
                      </Button>
                    ) : (
                      <Button className="w-full" variant="outline" disabled>Checkout is being configured</Button>
                    )}
                    {hasManagedSubscription && !hasCustomerPortal ? (
                      <p className="text-center text-xs text-muted-foreground">Contact CareMetric to change this managed subscription.</p>
                    ) : null}
                    {!pkg.contact_sales && price && !price.stripe_price_id && isPlatformAdmin ? (
                      <p className="text-center text-xs text-muted-foreground">Display pricing is ready; Checkout remains off until an immutable Stripe Price is mapped.</p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {organizationId ? (
        <Alert>
          <RefreshCw className="h-4 w-4" />
          <AlertTitle>{catalogIsFlat ? "How flat billing works" : "How quantities stay current"}</AlertTitle>
          <AlertDescription>
            {catalogIsFlat
              ? "Checkout always bills quantity 1 for flat plans. The subscription amount is the package fee; roster size does not change the invoice. Stripe webhooks keep subscription status in sync."
              : "Checkout measures the organization's database again on the server. Synthetic demo records and sandbox facilities are excluded, and a browser-supplied quantity cannot reduce the billable count."}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
