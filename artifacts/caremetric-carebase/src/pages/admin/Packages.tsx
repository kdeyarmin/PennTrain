import { useMemo, useState } from "react";
import {
  useListPackages,
  useCreatePackage,
  useUpdatePackage,
  useDeletePackage,
  useListPackageBillingPrices,
  useCreatePackageBillingPrice,
  useUpdatePackageBillingPrice,
  useDeletePackageBillingPrice,
  type Package,
  type PackageBillingPrice,
} from "@/hooks/usePackages";
import type { Json } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle, Bed, Building2, CheckCircle2, DollarSign, GraduationCap,
  Package as PackageIcon, Pencil, Plus, Settings2, Trash2, Users,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  ALL_PURCHASABLE_PRODUCT_MODULE_IDS,
  PRODUCT_MODULES,
  withModuleDependencies,
  type ProductModuleId,
  type PurchasableProductModuleId,
} from "@/lib/productModules";

// Expand a package's explicitly enabled modules so the all-inclusive CareBase bundle implies its
// bundled operational pillars, mirroring withModuleDependencies used by the runtime access layer.
function expandPurchasableModules(modules: Iterable<PurchasableProductModuleId>): PurchasableProductModuleId[] {
  const resolved = withModuleDependencies(modules as Iterable<ProductModuleId>);
  return ALL_PURCHASABLE_PRODUCT_MODULE_IDS.filter((moduleId) => resolved.has(moduleId));
}

type PricingStrategy = "flat_rate" | "per_unit" | "hybrid" | "custom";
type BillingMetric = "flat" | "active_learner" | "active_user" | "active_resident" | "facility";
type PricingModel = "flat" | "per_unit" | "graduated" | "volume" | "flat_plus_overage" | "custom";

interface PackageFormData {
  name: string;
  description: string;
  isActive: boolean;
  isRecommended: boolean;
  contactSales: boolean;
  pricingStrategy: PricingStrategy;
  trialDays: string;
  annualDiscountPercent: string;
  sortOrder: string;
  facilityLimit: string;
  learnerLimit: string;
  priceMonthly: string;
  featuresJson: string;
  enabledModules: PurchasableProductModuleId[];
}

interface PriceFormData {
  packageId: string;
  displayName: string;
  recurringInterval: "month" | "year";
  billingMetric: BillingMetric;
  pricingModel: PricingModel;
  baseAmount: string;
  unitAmount: string;
  includedQuantity: string;
  minimumQuantity: string;
  maximumQuantity: string;
  stripePriceId: string;
  currency: string;
  isPrimary: boolean;
  isActive: boolean;
  sortOrder: string;
}

const EMPTY_PACKAGE_FORM: PackageFormData = {
  name: "",
  description: "",
  isActive: true,
  isRecommended: false,
  contactSales: false,
  pricingStrategy: "hybrid",
  trialDays: "14",
  annualDiscountPercent: "16.67",
  sortOrder: "0",
  facilityLimit: "",
  learnerLimit: "",
  priceMonthly: "",
  featuresJson: "{}",
  enabledModules: [...ALL_PURCHASABLE_PRODUCT_MODULE_IDS],
};

const EMPTY_PRICE_FORM: PriceFormData = {
  packageId: "",
  displayName: "Monthly subscription",
  recurringInterval: "month",
  billingMetric: "active_learner",
  pricingModel: "flat_plus_overage",
  baseAmount: "",
  unitAmount: "",
  includedQuantity: "0",
  minimumQuantity: "1",
  maximumQuantity: "",
  stripePriceId: "",
  currency: "usd",
  isPrimary: true,
  isActive: true,
  sortOrder: "0",
};

const BILLING_METRICS: Array<{ value: BillingMetric; label: string; unit: string }> = [
  { value: "flat", label: "Flat subscription", unit: "subscription" },
  { value: "active_learner", label: "Active learner", unit: "learner" },
  { value: "active_user", label: "Active user", unit: "user" },
  { value: "active_resident", label: "Active resident", unit: "resident" },
  { value: "facility", label: "Facility", unit: "facility" },
];

const PRICING_MODELS: Array<{ value: PricingModel; label: string }> = [
  { value: "flat_plus_overage", label: "Base + included units + overage" },
  { value: "flat", label: "Flat rate" },
  { value: "per_unit", label: "Per unit" },
  { value: "graduated", label: "Graduated tiers" },
  { value: "volume", label: "Volume tiers" },
  { value: "custom", label: "Custom contract" },
];

// Effective purchasable modules for a package, expanded so CareBase implies its bundled pillars.
// Legacy packages predate the module contract and retain full access through the true defaults.
function enabledModulesFromFeatures(features: Json | null): PurchasableProductModuleId[] {
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    return [...ALL_PURCHASABLE_PRODUCT_MODULE_IDS];
  }
  const record = features as Record<string, Json | undefined>;
  const hasModuleContract = PRODUCT_MODULES.some((module) => typeof record[module.entitlementKey] === "boolean");
  if (!hasModuleContract) return [...ALL_PURCHASABLE_PRODUCT_MODULE_IDS];
  const enabled = PRODUCT_MODULES
    .filter((module) => record[module.entitlementKey] === true)
    .map((module) => module.id);
  return expandPurchasableModules(enabled);
}

// Compact badge list: the all-inclusive CareBase bundle collapses to a single badge, otherwise the
// individually enabled pillars are shown.
function displayModulesFromFeatures(features: Json | null): PurchasableProductModuleId[] {
  const enabled = enabledModulesFromFeatures(features);
  return enabled.includes("carebase") ? ["carebase"] : enabled;
}

function money(cents: number | null, currency = "usd"): string {
  if (cents === null || cents === undefined) return "Custom";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function centsInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function dollarsToCents(value: string): number {
  return Math.round(Number(value || 0) * 100);
}

function metricDefinition(metric: string) {
  return BILLING_METRICS.find((option) => option.value === metric) ?? BILLING_METRICS[0];
}

function pluralize(unit: string, quantity: number): string {
  return quantity === 1 ? unit : `${unit}s`;
}

function strategyLabel(strategy: string): string {
  return ({
    flat_rate: "Flat rate",
    per_unit: "Per unit",
    hybrid: "Base + usage",
    custom: "Custom contract",
  } as Record<string, string>)[strategy] ?? strategy;
}

function pricingSummary(pkg: Package, price?: PackageBillingPrice): string {
  if (pkg.contact_sales || pkg.pricing_strategy === "custom") return "Custom annual contract";
  if (!price) return pkg.price_monthly_cents === null ? "Price not configured" : `${money(pkg.price_monthly_cents)}/month`;
  const metric = metricDefinition(price.billing_metric);
  if (price.billing_metric === "flat" || price.pricing_model === "flat") {
    return `${money(price.base_amount_cents, price.currency)}/${price.recurring_interval}`;
  }
  const base = `${money(price.base_amount_cents, price.currency)}/${price.recurring_interval}`;
  const included = price.included_quantity > 0
    ? ` includes ${price.included_quantity} ${pluralize(metric.unit, price.included_quantity)}`
    : "";
  const overage = price.unit_amount_cents === null
    ? ""
    : `, then ${money(price.unit_amount_cents, price.currency)}/${metric.unit}`;
  return `${base}${included}${overage}`;
}

function metricIcon(metric: string) {
  if (metric === "active_learner") return GraduationCap;
  if (metric === "active_resident") return Bed;
  if (metric === "facility") return Building2;
  if (metric === "active_user") return Users;
  return DollarSign;
}

export default function Packages() {
  const { toast } = useToast();
  const { data: packages, isLoading } = useListPackages();
  const { data: prices, isLoading: pricesLoading } = useListPackageBillingPrices();
  const { mutate: createPackage, isPending: creating } = useCreatePackage();
  const { mutate: updatePackage, isPending: updating } = useUpdatePackage();
  const { mutate: deletePackage, isPending: deleting } = useDeletePackage();
  const { mutate: createPrice, isPending: creatingPrice } = useCreatePackageBillingPrice();
  const { mutate: updatePrice, isPending: updatingPrice } = useUpdatePackageBillingPrice();
  const { mutate: deletePrice, isPending: deletingPrice } = useDeletePackageBillingPrice();

  const [showPackageForm, setShowPackageForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [packageForm, setPackageForm] = useState<PackageFormData>(EMPTY_PACKAGE_FORM);
  const [showPriceForm, setShowPriceForm] = useState(false);
  const [editPriceId, setEditPriceId] = useState<string | null>(null);
  const [deletePriceId, setDeletePriceId] = useState<string | null>(null);
  const [priceForm, setPriceForm] = useState<PriceFormData>(EMPTY_PRICE_FORM);

  const packageById = useMemo(
    () => new Map((packages ?? []).map((pkg) => [pkg.id, pkg])),
    [packages],
  );

  const packageField = <K extends keyof PackageFormData>(key: K, value: PackageFormData[K]) =>
    setPackageForm((current) => ({ ...current, [key]: value }));
  const priceField = <K extends keyof PriceFormData>(key: K, value: PriceFormData[K]) =>
    setPriceForm((current) => ({ ...current, [key]: value }));

  const openCreatePackage = () => {
    setEditId(null);
    setPackageForm(EMPTY_PACKAGE_FORM);
    setShowPackageForm(true);
  };

  const openEditPackage = (pkg: Package) => {
    setEditId(pkg.id);
    setPackageForm({
      name: pkg.name,
      description: pkg.description,
      isActive: pkg.is_active,
      isRecommended: pkg.is_recommended,
      contactSales: pkg.contact_sales,
      pricingStrategy: pkg.pricing_strategy as PricingStrategy,
      trialDays: String(pkg.trial_days),
      annualDiscountPercent: String(pkg.annual_discount_percent),
      sortOrder: String(pkg.sort_order ?? 0),
      facilityLimit: pkg.facility_limit === null ? "" : String(pkg.facility_limit),
      learnerLimit: pkg.learner_limit === null ? "" : String(pkg.learner_limit),
      priceMonthly: centsInput(pkg.price_monthly_cents),
      featuresJson: pkg.features === null ? "{}" : JSON.stringify(pkg.features, null, 2),
      enabledModules: enabledModulesFromFeatures(pkg.features),
    });
    setShowPackageForm(true);
  };

  const openCreatePrice = (packageId = "") => {
    setEditPriceId(null);
    setPriceForm({ ...EMPTY_PRICE_FORM, packageId });
    setShowPriceForm(true);
  };

  const openEditPrice = (price: PackageBillingPrice) => {
    setEditPriceId(price.id);
    setPriceForm({
      packageId: price.package_id,
      displayName: price.display_name,
      recurringInterval: price.recurring_interval as "month" | "year",
      billingMetric: price.billing_metric as BillingMetric,
      pricingModel: price.pricing_model as PricingModel,
      baseAmount: centsInput(price.base_amount_cents),
      unitAmount: centsInput(price.unit_amount_cents),
      includedQuantity: String(price.included_quantity),
      minimumQuantity: String(price.minimum_quantity),
      maximumQuantity: price.maximum_quantity === null ? "" : String(price.maximum_quantity),
      stripePriceId: price.stripe_price_id ?? "",
      currency: price.currency,
      isPrimary: price.is_primary,
      isActive: price.is_active,
      sortOrder: String(price.sort_order),
    });
    setShowPriceForm(true);
  };

  const handlePackageSubmit = () => {
    if (!packageForm.name.trim()) {
      toast({ title: "Package name is required", variant: "destructive" });
      return;
    }

    let features: Json = {};
    try {
      features = packageForm.featuresJson.trim() ? JSON.parse(packageForm.featuresJson) as Json : {};
    } catch {
      toast({ title: "Invalid JSON in features", description: "Fix the advanced feature document before saving.", variant: "destructive" });
      return;
    }
    if (!features || typeof features !== "object" || Array.isArray(features)) {
      toast({ title: "Features must be a JSON object", variant: "destructive" });
      return;
    }
    const featureRecord = features as Record<string, Json | undefined>;
    for (const module of PRODUCT_MODULES) {
      featureRecord[module.entitlementKey] = packageForm.enabledModules.includes(module.id);
    }

    const payload = {
      name: packageForm.name.trim(),
      description: packageForm.description.trim(),
      is_active: packageForm.isActive,
      is_recommended: packageForm.isRecommended,
      contact_sales: packageForm.contactSales,
      pricing_strategy: packageForm.pricingStrategy,
      trial_days: Number.parseInt(packageForm.trialDays || "0", 10),
      annual_discount_percent: Number(packageForm.annualDiscountPercent || 0),
      sort_order: Number.parseInt(packageForm.sortOrder || "0", 10),
      facility_limit: packageForm.facilityLimit.trim() ? Number.parseInt(packageForm.facilityLimit, 10) : null,
      learner_limit: packageForm.learnerLimit.trim() ? Number.parseInt(packageForm.learnerLimit, 10) : null,
      price_monthly_cents: packageForm.priceMonthly.trim() ? dollarsToCents(packageForm.priceMonthly) : null,
      features: featureRecord,
    };

    if (editId) {
      updatePackage({ id: editId, ...payload }, {
        onSuccess: () => {
          toast({ title: "Package updated" });
          setShowPackageForm(false);
          setEditId(null);
        },
        onError: (error: Error) => toast({ title: "Package could not be updated", description: error.message, variant: "destructive" }),
      });
    } else {
      createPackage(payload, {
        onSuccess: (createdPackage) => {
          toast({ title: "Package created", description: "Add its monthly or annual billing configuration next." });
          setShowPackageForm(false);
          setPackageForm(EMPTY_PACKAGE_FORM);
          openCreatePrice(createdPackage.id);
        },
        onError: (error: Error) => toast({ title: "Package could not be created", description: error.message, variant: "destructive" }),
      });
    }
  };

  const handlePriceSubmit = () => {
    if (!priceForm.packageId || !priceForm.displayName.trim()) {
      toast({ title: "Package and price name are required", variant: "destructive" });
      return;
    }
    if (priceForm.stripePriceId && !/^price_[A-Za-z0-9]+$/.test(priceForm.stripePriceId)) {
      toast({ title: "Stripe Price ID must begin with price_", variant: "destructive" });
      return;
    }

    const flat = priceForm.billingMetric === "flat";
    const payload = {
      package_id: priceForm.packageId,
      display_name: priceForm.displayName.trim(),
      recurring_interval: priceForm.recurringInterval,
      billing_metric: priceForm.billingMetric,
      pricing_model: flat ? "flat" : priceForm.pricingModel,
      base_amount_cents: dollarsToCents(priceForm.baseAmount),
      unit_amount_cents: flat || !priceForm.unitAmount.trim() ? null : dollarsToCents(priceForm.unitAmount),
      included_quantity: flat ? 0 : Number.parseInt(priceForm.includedQuantity || "0", 10),
      minimum_quantity: flat ? 1 : Number.parseInt(priceForm.minimumQuantity || "1", 10),
      maximum_quantity: flat ? 1 : priceForm.maximumQuantity.trim() ? Number.parseInt(priceForm.maximumQuantity, 10) : null,
      stripe_price_id: priceForm.stripePriceId.trim() || null,
      currency: priceForm.currency.trim().toLowerCase(),
      is_seat_based: !flat,
      is_primary: priceForm.isPrimary,
      is_active: priceForm.isActive,
      sort_order: Number.parseInt(priceForm.sortOrder || "0", 10),
    };

    const callbacks = {
      onSuccess: () => {
        toast({ title: editPriceId ? "Billing configuration updated" : "Billing configuration created" });
        setShowPriceForm(false);
        setEditPriceId(null);
      },
      onError: (error: Error) => toast({ title: "Billing configuration could not be saved", description: error.message, variant: "destructive" }),
    };
    if (editPriceId) updatePrice({ id: editPriceId, ...payload }, callbacks);
    else createPrice(payload, callbacks);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Packages & billing</h1>
          <p className="text-muted-foreground">Control product access, value metrics, pricing, trials, and Stripe checkout mappings.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openCreatePrice()}>
            <DollarSign className="mr-2 h-4 w-4" /> Add billing price
          </Button>
          <Button onClick={openCreatePackage}>
            <Plus className="mr-2 h-4 w-4" /> Add package
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Settings2 className="h-5 w-5 text-primary" /> Recommended subscription structure
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border bg-background/80 p-4">
            <div className="mb-2 flex items-center gap-2 font-medium"><DollarSign className="h-4 w-4 text-primary" /> Predictable base</div>
            <p className="text-sm text-muted-foreground">Every self-serve package starts with a base fee that includes meaningful usage, protecting revenue and customer budgets.</p>
          </div>
          <div className="rounded-lg border bg-background/80 p-4">
            <div className="mb-2 flex items-center gap-2 font-medium"><GraduationCap className="h-4 w-4 text-primary" /> Value-aligned growth</div>
            <p className="text-sm text-muted-foreground">Train scales by active learner. CareBase scales by active resident, so administrators and staff are not penalized for collaborating.</p>
          </div>
          <div className="rounded-lg border bg-background/80 p-4">
            <div className="mb-2 flex items-center gap-2 font-medium"><Building2 className="h-4 w-4 text-primary" /> Contract flexibility</div>
            <p className="text-sm text-muted-foreground">Annual terms get an editable discount; multi-facility portfolios use negotiated pricing and tailored rollout terms.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Subscription packages</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, index) => <div key={index} className="h-14 animate-pulse rounded-md bg-muted" />)}</div>
          ) : !packages?.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted"><PackageIcon className="h-6 w-6 text-muted-foreground" /></div>
              <p className="font-medium text-muted-foreground">No packages yet</p>
              <p className="mt-1 text-sm text-muted-foreground/60">Create a package, then attach a billing configuration.</p>
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Package</TableHead><TableHead>Products</TableHead><TableHead>Strategy</TableHead>
                <TableHead>Monthly offer</TableHead><TableHead>Trial / annual</TableHead><TableHead>Checkout</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {packages.map((pkg) => {
                  const packagePrices = (prices ?? []).filter((price) => price.package_id === pkg.id);
                  const now = Date.now();
                  const monthlyPrice = packagePrices
                    .filter((price) => price.recurring_interval === "month" && price.is_active && price.is_primary
                      && Date.parse(price.effective_from) <= now
                      && (!price.effective_to || Date.parse(price.effective_to) > now))
                    .sort((left, right) => Date.parse(right.effective_from) - Date.parse(left.effective_from))[0];
                  const checkoutReady = Boolean(monthlyPrice?.stripe_price_id) || pkg.contact_sales;
                  return (
                    <TableRow key={pkg.id}>
                      <TableCell className="max-w-[280px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{pkg.name}</span>
                          {!pkg.is_active && <Badge variant="secondary">Inactive</Badge>}
                          {pkg.is_recommended && <Badge>Recommended</Badge>}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{pkg.description || "No package description"}</p>
                      </TableCell>
                      <TableCell><div className="flex flex-wrap gap-1">{displayModulesFromFeatures(pkg.features).map((moduleId) => {
                        const module = PRODUCT_MODULES.find((candidate) => candidate.id === moduleId)!;
                        return <Badge key={moduleId} variant="outline">{module.shortName}</Badge>;
                      })}</div></TableCell>
                      <TableCell><Badge variant="secondary">{strategyLabel(pkg.pricing_strategy)}</Badge></TableCell>
                      <TableCell className="max-w-[280px] text-sm">{pricingSummary(pkg, monthlyPrice)}</TableCell>
                      <TableCell className="text-sm">
                        <div>{pkg.trial_days ? `${pkg.trial_days}-day trial` : "No trial"}</div>
                        <div className="text-xs text-muted-foreground">{pkg.annual_discount_percent ? `${pkg.annual_discount_percent}% annual discount` : "No annual discount"}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={checkoutReady ? "outline" : "secondary"} className="gap-1">
                          {checkoutReady ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                          {pkg.contact_sales ? "Sales-led" : checkoutReady ? "Ready" : "Stripe ID needed"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right"><div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openCreatePrice(pkg.id)} aria-label={`Add price to ${pkg.name}`}><DollarSign className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditPackage(pkg)} aria-label={`Edit ${pkg.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(pkg.id)} aria-label={`Delete ${pkg.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>Billing configurations</span>
            <Badge variant="outline">Stripe Prices stay immutable; archive and replace to reprice</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pricesLoading ? <div className="h-24 animate-pulse rounded-md bg-muted" /> : !prices?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No billing configurations yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Package / cadence</TableHead><TableHead>Value metric</TableHead><TableHead>Commercial model</TableHead>
                <TableHead>Base</TableHead><TableHead>Included / overage</TableHead><TableHead>Stripe mapping</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>{prices.map((price) => {
                const metric = metricDefinition(price.billing_metric);
                const MetricIcon = metricIcon(price.billing_metric);
                return (
                  <TableRow key={price.id}>
                    <TableCell><div className="font-medium">{packageById.get(price.package_id)?.name ?? "Unknown package"}</div><div className="text-xs capitalize text-muted-foreground">{price.display_name} · {price.recurring_interval}ly</div></TableCell>
                    <TableCell><div className="flex items-center gap-2 text-sm"><MetricIcon className="h-4 w-4 text-muted-foreground" />{metric.label}</div></TableCell>
                    <TableCell><Badge variant="secondary">{PRICING_MODELS.find((model) => model.value === price.pricing_model)?.label ?? price.pricing_model}</Badge></TableCell>
                    <TableCell>{money(price.base_amount_cents, price.currency)}</TableCell>
                    <TableCell className="text-sm">
                      <div>{price.included_quantity} {pluralize(metric.unit, price.included_quantity)} included</div>
                      <div className="text-xs text-muted-foreground">{price.unit_amount_cents === null ? "No unit overage" : `${money(price.unit_amount_cents, price.currency)}/${metric.unit}`}</div>
                    </TableCell>
                    <TableCell>
                      {price.stripe_price_id ? <code className="rounded bg-muted px-1.5 py-1 text-xs">{price.stripe_price_id}</code> : <Badge variant="secondary">Draft - ID required</Badge>}
                    </TableCell>
                    <TableCell className="text-right"><div className="flex items-center justify-end gap-1">
                      {!price.is_active && <Badge variant="secondary">Inactive</Badge>}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditPrice(price)} aria-label={`Edit ${price.display_name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeletePriceId(price.id)}
                        disabled={Boolean(price.stripe_price_id)}
                        title={price.stripe_price_id ? "Archive Stripe-mapped prices by making them inactive" : "Delete draft billing configuration"}
                        aria-label={`Delete ${price.display_name}`}
                      ><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div></TableCell>
                  </TableRow>
                );
              })}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showPackageForm} onOpenChange={(open) => { if (!open) { setShowPackageForm(false); setEditId(null); } }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit package" : "Add package"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
            <div className="col-span-full space-y-1.5"><Label>Package name *</Label><Input value={packageForm.name} onChange={(event) => packageField("name", event.target.value)} placeholder="CareMetric Train" /></div>
            <div className="col-span-full space-y-1.5"><Label>Customer-facing description</Label><Textarea value={packageForm.description} onChange={(event) => packageField("description", event.target.value)} placeholder="Describe the outcome and included product experience." className="min-h-20" /></div>
            <div className="space-y-1.5"><Label>Pricing strategy</Label><Select value={packageForm.pricingStrategy} onValueChange={(value) => packageField("pricingStrategy", value as PricingStrategy)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hybrid">Base + usage</SelectItem><SelectItem value="flat_rate">Flat rate</SelectItem><SelectItem value="per_unit">Per unit</SelectItem><SelectItem value="custom">Custom contract</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Starting monthly price ($)</Label><Input type="number" step="0.01" min="0" value={packageForm.priceMonthly} onChange={(event) => packageField("priceMonthly", event.target.value)} placeholder="239.00" /></div>
            <div className="space-y-1.5"><Label>Trial days</Label><Input type="number" min="0" max="90" value={packageForm.trialDays} onChange={(event) => packageField("trialDays", event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Annual discount (%)</Label><Input type="number" step="0.01" min="0" max="50" value={packageForm.annualDiscountPercent} onChange={(event) => packageField("annualDiscountPercent", event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Hard facility limit</Label><Input type="number" min="0" value={packageForm.facilityLimit} onChange={(event) => packageField("facilityLimit", event.target.value)} placeholder="Unlimited" /><p className="text-xs text-muted-foreground">Authorization limit, not included billing quantity.</p></div>
            <div className="space-y-1.5"><Label>Hard learner limit</Label><Input type="number" min="0" value={packageForm.learnerLimit} onChange={(event) => packageField("learnerLimit", event.target.value)} placeholder="Unlimited" /><p className="text-xs text-muted-foreground">Authorization limit, not included billing quantity.</p></div>
            <div className="space-y-1.5"><Label>Sort order</Label><Input type="number" value={packageForm.sortOrder} onChange={(event) => packageField("sortOrder", event.target.value)} /></div>
            <div className="col-span-full grid gap-3 sm:grid-cols-3">
              <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-sm font-medium">Active</p><p className="text-xs text-muted-foreground">Selectable by customers</p></div><Switch checked={packageForm.isActive} onCheckedChange={(value) => packageField("isActive", value)} /></div>
              <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-sm font-medium">Recommended</p><p className="text-xs text-muted-foreground">Highlights the package</p></div><Switch checked={packageForm.isRecommended} onCheckedChange={(value) => packageField("isRecommended", value)} /></div>
              <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-sm font-medium">Contact sales</p><p className="text-xs text-muted-foreground">Disables self-serve price</p></div><Switch checked={packageForm.contactSales} onCheckedChange={(value) => packageField("contactSales", value)} /></div>
            </div>
            <div className="col-span-full space-y-1.5"><Label>CareMetric products</Label><div className="space-y-2 rounded-lg border p-3">{PRODUCT_MODULES.map((module) => {
              const forcedByCareBase = module.id !== "carebase" && packageForm.enabledModules.includes("carebase");
              const enabled = packageForm.enabledModules.includes(module.id) || forcedByCareBase;
              return <div key={module.id} className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">{module.name}</p><p className="text-xs text-muted-foreground">{module.description}</p></div><Switch checked={enabled} disabled={forcedByCareBase} onCheckedChange={(checked) => packageField("enabledModules", checked ? (module.id === "carebase" ? [...ALL_PURCHASABLE_PRODUCT_MODULE_IDS] : Array.from(new Set([...packageForm.enabledModules, module.id]))) : packageForm.enabledModules.filter((moduleId) => moduleId !== module.id))} aria-label={`${enabled ? "Disable" : "Enable"} ${module.name}`} /></div>;
            })}</div><p className="text-xs text-muted-foreground">CareMetric CareBase is the all-inclusive bundle: it always includes Train, Workforce, Compliance, and Billing.</p></div>
            <div className="col-span-full space-y-1.5"><Label>Advanced feature flags (JSON)</Label><Textarea value={packageForm.featuresJson} onChange={(event) => packageField("featuresJson", event.target.value)} className="min-h-24 font-mono text-xs" /><p className="text-xs text-muted-foreground">Product module keys above are synchronized when you save.</p></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowPackageForm(false)}>Cancel</Button><Button onClick={handlePackageSubmit} disabled={creating || updating}>{creating || updating ? "Saving..." : editId ? "Save changes" : "Create package"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPriceForm} onOpenChange={(open) => { if (!open) { setShowPriceForm(false); setEditPriceId(null); } }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editPriceId ? "Edit billing configuration" : "Add billing configuration"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Package *</Label><Select value={priceForm.packageId} onValueChange={(value) => priceField("packageId", value)}><SelectTrigger><SelectValue placeholder="Choose a package" /></SelectTrigger><SelectContent>{packages?.map((pkg) => <SelectItem key={pkg.id} value={pkg.id}>{pkg.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Configuration name *</Label><Input value={priceForm.displayName} onChange={(event) => priceField("displayName", event.target.value)} placeholder="Monthly active learners" /></div>
            <div className="space-y-1.5"><Label>Billing cadence</Label><Select value={priceForm.recurringInterval} onValueChange={(value) => priceField("recurringInterval", value as "month" | "year")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="month">Monthly</SelectItem><SelectItem value="year">Annual</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Value metric</Label><Select value={priceForm.billingMetric} onValueChange={(value) => priceField("billingMetric", value as BillingMetric)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BILLING_METRICS.map((metric) => <SelectItem key={metric.value} value={metric.value}>{metric.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="col-span-full space-y-1.5"><Label>Pricing model</Label><Select value={priceForm.billingMetric === "flat" ? "flat" : priceForm.pricingModel} disabled={priceForm.billingMetric === "flat"} onValueChange={(value) => priceField("pricingModel", value as PricingModel)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRICING_MODELS.map((model) => <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Base amount ($)</Label><Input type="number" step="0.01" min="0" value={priceForm.baseAmount} onChange={(event) => priceField("baseAmount", event.target.value)} placeholder="239.00" /></div>
            <div className="space-y-1.5"><Label>Per-unit / overage amount ($)</Label><Input type="number" step="0.01" min="0" disabled={priceForm.billingMetric === "flat"} value={priceForm.unitAmount} onChange={(event) => priceField("unitAmount", event.target.value)} placeholder="4.00" /></div>
            <div className="space-y-1.5"><Label>Included quantity</Label><Input type="number" min="0" disabled={priceForm.billingMetric === "flat"} value={priceForm.includedQuantity} onChange={(event) => priceField("includedQuantity", event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Minimum quantity</Label><Input type="number" min="1" disabled={priceForm.billingMetric === "flat"} value={priceForm.minimumQuantity} onChange={(event) => priceField("minimumQuantity", event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Maximum quantity</Label><Input type="number" min="1" disabled={priceForm.billingMetric === "flat"} value={priceForm.maximumQuantity} onChange={(event) => priceField("maximumQuantity", event.target.value)} placeholder="Unlimited" /></div>
            <div className="space-y-1.5"><Label>Currency</Label><Input value={priceForm.currency} maxLength={3} onChange={(event) => priceField("currency", event.target.value)} /></div>
            <div className="col-span-full space-y-1.5"><Label>Stripe Price ID</Label><Input value={priceForm.stripePriceId} onChange={(event) => priceField("stripePriceId", event.target.value)} placeholder="price_... (optional while drafting)" /><p className="text-xs text-muted-foreground">Create an immutable recurring Price in Stripe with the same cadence and tiers, then paste its ID here to enable checkout.</p></div>
            <div className="space-y-1.5"><Label>Sort order</Label><Input type="number" value={priceForm.sortOrder} onChange={(event) => priceField("sortOrder", event.target.value)} /></div>
            <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-sm font-medium">Active primary price</p><p className="text-xs text-muted-foreground">Eligible for checkout</p></div><div className="flex gap-3"><Switch checked={priceForm.isPrimary} onCheckedChange={(value) => priceField("isPrimary", value)} aria-label="Primary price" /><Switch checked={priceForm.isActive} onCheckedChange={(value) => priceField("isActive", value)} aria-label="Active price" /></div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowPriceForm(false)}>Cancel</Button><Button onClick={handlePriceSubmit} disabled={creatingPrice || updatingPrice}>{creatingPrice || updatingPrice ? "Saving..." : "Save billing configuration"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => { if (!open) setDeleteId(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete package</AlertDialogTitle><AlertDialogDescription>This permanently removes the package and its draft billing configurations. Packages assigned to an organization cannot be deleted.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (!deleteId) return; deletePackage(deleteId, { onSuccess: () => { toast({ title: "Package deleted" }); setDeleteId(null); }, onError: (error: Error) => toast({ title: "Package could not be deleted", description: error.message, variant: "destructive" }) }); }} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleting ? "Deleting..." : "Delete"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <AlertDialog open={Boolean(deletePriceId)} onOpenChange={(open) => { if (!open) setDeletePriceId(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete billing configuration</AlertDialogTitle><AlertDialogDescription>Delete only draft or unused configurations. For a live Stripe Price, make this row inactive and add a replacement so historical subscription reconciliation remains intact.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (!deletePriceId) return; deletePrice(deletePriceId, { onSuccess: () => { toast({ title: "Billing configuration deleted" }); setDeletePriceId(null); }, onError: (error: Error) => toast({ title: "Billing configuration could not be deleted", description: error.message, variant: "destructive" }) }); }} disabled={deletingPrice} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deletingPrice ? "Deleting..." : "Delete"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
