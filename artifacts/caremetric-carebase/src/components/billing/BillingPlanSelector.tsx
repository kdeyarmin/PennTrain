import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  Check,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { Json } from "@/lib/database.types";
import {
  billingMetricDefinition,
  billingPriceSummary,
  estimatedBillingAmountCents,
  formatBillingMoney,
  measuredBillingQuantity,
  resolvedBillingQuantity,
} from "@/lib/billingCatalog";
import { PRODUCT_MODULES } from "@/lib/productModules";
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

function enabledModuleNames(features: Json | null): string[] {
  if (!features || typeof features !== "object" || Array.isArray(features)) return [];
  const record = features as Record<string, Json | undefined>;
  return PRODUCT_MODULES
    .filter((module) => record[module.entitlementKey] === true)
    .map((module) => module.name);
}

function effectivePrice(
  prices: PackageBillingPrice[],
  packageId: string,
  interval: "month" | "year",
): PackageBillingPrice | undefined {
  const now = Date.now();
  return prices
    .filter((price) => price.package_id === packageId
      && price.recurring_interval === interval
      && price.is_active
      && price.is_primary
      && Date.parse(price.effective_from) <= now
      && (!price.effective_to || Date.parse(price.effective_to) > now))
    .sort((left, right) => Date.parse(right.effective_from) - Date.parse(left.effective_from))[0];
}

function subscriptionStateLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function BillingPlanSelector() {
  const { user } = useAuth();
  const { toast } = useToast();
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
  const currentPackageId = currentSubscription?.package_id ?? organizationQuery.data?.package_id;
  const hasManagedSubscription = !!currentSubscription;
  const hasCustomerPortal = !!billingAccountQuery.data?.account?.stripe_customer_id;
  const usage = usageQuery.data;
  const busy = session.isPending;

  const openPortal = async () => {
    if (!organizationId) return;
    try {
      const result = await session.mutateAsync({
        organizationId,
        action: "portal",
        returnUrl: `${window.location.origin}${isPlatformAdmin ? "/admin/enterprise" : "/app/enterprise"}`,
        idempotencyKey: crypto.randomUUID(),
      });
      window.location.assign(result.data.url);
    } catch (error) {
      toast({
        title: "Billing portal could not be opened",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const startCheckout = async (pkg: Package, price: PackageBillingPrice) => {
    if (!organizationId || !usage) return;
    const quantity = resolvedBillingQuantity(price.billing_metric, usage, price.minimum_quantity);
    if (price.maximum_quantity !== null && quantity > price.maximum_quantity) {
      toast({
        title: "This organization needs contract pricing",
        description: `The measured quantity of ${quantity} exceeds this plan's self-service maximum.`,
        variant: "destructive",
      });
      return;
    }
    try {
      const returnPath = isPlatformAdmin ? "/admin/enterprise" : "/app/enterprise";
      const result = await session.mutateAsync({
        organizationId,
        action: "checkout",
        packageId: pkg.id,
        billingInterval: interval,
        quantity,
        successUrl: `${window.location.origin}${returnPath}?billing=success`,
        cancelUrl: `${window.location.origin}${returnPath}?billing=cancelled`,
        idempotencyKey: crypto.randomUUID(),
      });
      window.location.assign(result.data.url);
    } catch (error) {
      toast({
        title: "Secure checkout could not be opened",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Plans and subscription</CardTitle>
            <CardDescription className="mt-1">
              Pricing automatically uses the organization's current active records. Staff users are not charged on CareBase.
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
              <Label>Organization</Label>
              <Select value={selectedOrganizationId} onValueChange={setSelectedOrganizationId}>
                <SelectTrigger><SelectValue placeholder="Select an organization" /></SelectTrigger>
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
              <AlertDescription>Choose the tenant whose usage and subscription you want to review.</AlertDescription>
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
                  {currentSubscription?.quantity_sync_status === "synced" ? <Badge variant="outline">Quantity synchronized</Badge> : null}
                </div>
                <Tabs value={interval} onValueChange={(value) => setInterval(value as "month" | "year")}>
                  <TabsList>
                    <TabsTrigger value="month">Monthly</TabsTrigger>
                    <TabsTrigger value="year" className="gap-2">
                      Annual
                      <Badge variant="secondary" className="hidden sm:inline-flex">Save about 2 months</Badge>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {usageQuery.isLoading ? (
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

      {organizationId && usage ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {packages.map((pkg) => {
            const price = effectivePrice(pricesQuery.data ?? [], pkg.id, interval);
            const modules = enabledModuleNames(pkg.features);
            const metric = billingMetricDefinition(price?.billing_metric ?? "flat");
            const measuredQuantity = price ? measuredBillingQuantity(price.billing_metric, usage) : 1;
            const quantity = price
              ? resolvedBillingQuantity(price.billing_metric, usage, price.minimum_quantity)
              : 1;
            const estimatedAmount = price ? estimatedBillingAmountCents(price, quantity) : null;
            const overMaximum = !!price?.maximum_quantity && quantity > price.maximum_quantity;
            const isCurrent = currentPackageId === pkg.id;
            const checkoutReady = !!price?.stripe_price_id && !overMaximum;
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
                      <p className="mt-1 text-sm text-muted-foreground">{billingPriceSummary(price)}</p>
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
                      <p className="font-medium">Automatic quantity: {quantity} {quantity === 1 ? metric.unit : `${metric.unit}s`}</p>
                      <p className="mt-1 text-muted-foreground">
                        {measuredQuantity} active now{quantity !== measuredQuantity ? `; ${price.minimum_quantity} minimum` : ""}.
                        {price.included_quantity > 0
                          ? ` ${price.included_quantity} included; ${Math.max(0, quantity - price.included_quantity)} overage.`
                          : ""}
                      </p>
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
          <AlertTitle>How quantities stay current</AlertTitle>
          <AlertDescription>
            Checkout measures the organization's database again on the server. Synthetic demo records and sandbox facilities are excluded, and a browser-supplied quantity cannot reduce the billable count.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
