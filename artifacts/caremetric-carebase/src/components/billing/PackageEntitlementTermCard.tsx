/**
 * Effective-dated entitlement terms for a package (BACKLOG.md G11).
 *
 * The module checkboxes above write `packages.features`, and a trigger copies that straight into
 * `package_entitlements` as an immediate, open-ended, `legacy_backfill` row -- which is the right
 * behaviour for "this package includes X" and the wrong one for "this package gains X on 1 September
 * under contract CM-2026-0142". `set_package_entitlement` is the only way to express the second, and
 * it had no caller, so a contracted future change could only be applied by somebody remembering to
 * tick a box on the right morning.
 */
import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import {
  entitlementTermIssues,
  parseEntitlementValue,
  termSummary,
  type FeatureValueType,
} from "@/lib/packageEntitlementTerm";
import { QueryError } from "@/components/QueryState";
import { facilityDayBounds } from "@/lib/dateUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }

const ENTITLEMENT_KEY = ["package_entitlements"] as const;

function useFeatureDefinitions() {
  return useQuery({
    queryKey: ["feature_definitions", "for-terms"],
    queryFn: async () => {
      // Active definitions only, so the picker cannot offer a feature the product no longer
      // has. This is convenience, not the gate: 20260906050000 made
      // app_private.validate_entitlement_value() refuse an INSERT naming a retired
      // definition, on the tables rather than in the RPCs (I33).
      //
      // The comment here previously said a retired definition was still read by
      // get_effective_entitlements. That was wrong -- that function ends with
      // `where d.is_active`, so a retired feature has never conferred anything. What it
      // could do was be written into a contract term that then granted nothing.
      const { data, error } = await supabase
        .from("feature_definitions")
        .select("feature_key, description, value_type, default_value")
        .eq("is_active", true)
        .order("feature_key");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

interface EntitlementTermRow {
  id: string;
  featureKey: string;
  entitlementValue: unknown;
  /** An instant, not a calendar day: `package_entitlements.effective_from` is `timestamptz`. */
  effectiveFromAt: string;
  effectiveToAt: string | null;
  contractReference: string | null;
  source: string;
}

// Mapped here rather than rendered raw so the timestamptz-vs-date distinction is stated once. The
// repo's date-only lint is name-based, and `effective_from` *is* a DATE on the regulatory rule
// tables -- reading this one as an instant is correct, and saying so beats an unexplained exception.
function usePackageEntitlements(packageId: string | undefined) {
  return useQuery({
    queryKey: [...ENTITLEMENT_KEY, packageId ?? null],
    queryFn: async (): Promise<EntitlementTermRow[]> => {
      const { data, error } = await supabase
        .from("package_entitlements")
        .select("id, feature_key, entitlement_value, effective_from, effective_to, contract_reference, source")
        .eq("package_id", packageId!)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        featureKey: row.feature_key,
        entitlementValue: row.entitlement_value,
        effectiveFromAt: row.effective_from,
        effectiveToAt: row.effective_to,
        contractReference: row.contract_reference,
        source: row.source,
      }));
    },
    enabled: !!packageId,
  });
}

function useSetPackageEntitlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      packageId: string;
      featureKey: string;
      entitlementValue: unknown;
      reason: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      contractReference: string | null;
    }) => {
      const { data, error } = await (supabase as unknown as RpcClient).rpc("set_package_entitlement", {
        p_package_id: input.packageId,
        p_feature_key: input.featureKey,
        p_entitlement_value: input.entitlementValue,
        p_reason: input.reason,
        p_effective_from: input.effectiveFrom,
        p_effective_to: input.effectiveTo,
        p_contract_reference: input.contractReference,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ENTITLEMENT_KEY }),
        queryClient.invalidateQueries({ queryKey: ["packages"] }),
      ]);
    },
  });
}

export function PackageEntitlementTermCard({
  packageId,
  packageName,
}: {
  packageId: string | undefined;
  packageName: string;
}) {
  const features = useFeatureDefinitions();
  const entitlements = usePackageEntitlements(packageId);
  const setTerm = useSetPackageEntitlement();
  const { toast } = useToast();

  const [featureKey, setFeatureKey] = useState("");
  const [rawValue, setRawValue] = useState("");
  const [reason, setReason] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [contractReference, setContractReference] = useState("");

  const now = new Date();
  const selectedFeature = (features.data ?? []).find((row) => row.feature_key === featureKey);
  const valueType = (selectedFeature?.value_type ?? "boolean") as FeatureValueType;
  const form = {
    packageId: packageId ?? "",
    featureKey,
    rawValue,
    valueType,
    reason,
    // Date inputs are facility calendar days — not UTC midnight.
    effectiveFrom: effectiveFrom ? facilityDayBounds(effectiveFrom).from : "",
    effectiveTo: effectiveTo ? facilityDayBounds(effectiveTo).from : "",
    contractReference,
  };
  const issues = entitlementTermIssues(form, now);
  const parsed = parseEntitlementValue(rawValue, valueType);

  const current = (entitlements.data ?? []).filter((row) => row.effectiveToAt === null);
  const scheduled = current.filter((row) => Date.parse(row.effectiveFromAt) > now.getTime());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />Contracted entitlement term
        </CardTitle>
        <CardDescription>
          For a change that starts on a date or comes from a specific agreement. The module checkboxes above
          apply immediately and open-ended; this records a term with its own dates and contract reference.
          {packageId ? ` Applies to ${packageName}.` : " Select a package to add a term."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {entitlements.isError && (
          <div className="md:col-span-2">
            <QueryError what="entitlement terms" error={entitlements.error} onRetry={() => void entitlements.refetch()} />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="entitlement-feature">Feature</Label>
          <Select
            value={featureKey}
            onValueChange={(value) => {
              setFeatureKey(value);
              const feature = (features.data ?? []).find((row) => row.feature_key === value);
              // Seed from the feature's declared default so the field starts valid for its type.
              setRawValue(feature ? JSON.stringify(feature.default_value).replace(/^"|"$/g, "") : "");
            }}
          >
            <SelectTrigger id="entitlement-feature"><SelectValue placeholder="Choose a feature" /></SelectTrigger>
            <SelectContent>
              {(features.data ?? []).map((feature) => (
                <SelectItem key={feature.feature_key} value={feature.feature_key}>
                  {feature.feature_key} ({feature.value_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedFeature && <p className="text-xs text-muted-foreground">{selectedFeature.description}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="entitlement-value">Value ({valueType})</Label>
          <Input
            id="entitlement-value"
            value={rawValue}
            onChange={(event) => setRawValue(event.target.value)}
            placeholder={valueType === "boolean" ? "true or false" : valueType === "json" ? '{"tier":"gold"}' : "value"}
          />
          {parsed.error && rawValue.trim() !== "" && (
            <p className="text-xs text-muted-foreground">{parsed.error}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="entitlement-from">Starts</Label>
          <Input id="entitlement-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entitlement-to">Ends (optional)</Label>
          <Input id="entitlement-to" type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entitlement-contract">Contract reference (optional)</Label>
          <Input id="entitlement-contract" value={contractReference} onChange={(e) => setContractReference(e.target.value)} placeholder="CM-2026-0142" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entitlement-reason">Reason</Label>
          <Textarea id="entitlement-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this package's entitlement is changing" />
        </div>

        <div className="md:col-span-2 space-y-2">
          {featureKey && <p className="text-sm">{termSummary(form, now)}</p>}
          {issues.map((issue) => <p key={issue} className="text-xs text-muted-foreground">{issue}</p>)}
          <Button
            disabled={!packageId || issues.length > 0 || setTerm.isPending}
            onClick={async () => {
              if (!packageId || !parsed.ok) return;
              try {
                await setTerm.mutateAsync({
                  packageId,
                  featureKey,
                  entitlementValue: parsed.value,
                  reason: reason.trim(),
                  effectiveFrom: form.effectiveFrom,
                  effectiveTo: form.effectiveTo || null,
                  contractReference: contractReference.trim() || null,
                });
                toast({ title: "Entitlement term recorded" });
                setReason("");
                setContractReference("");
              } catch (error) {
                toast({
                  title: "Entitlement term blocked",
                  description: error instanceof Error ? error.message : String(error),
                  variant: "destructive",
                });
              }
            }}
          >
            {setTerm.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Record term
          </Button>
        </div>

        {packageId && (
          <div className="md:col-span-2 space-y-1 border-t pt-3">
            <p className="text-sm font-medium">
              Open terms {scheduled.length > 0 ? `(${scheduled.length} scheduled for the future)` : ""}
            </p>
            {entitlements.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading open terms…</p>
            ) : entitlements.isError ? null : current.length === 0 ? (
              <p className="text-xs text-muted-foreground">No open terms on this package.</p>
            ) : null}
            {!entitlements.isLoading && !entitlements.isError && current.map((row) => (
              <p key={row.id} className="text-xs text-muted-foreground">
                {row.featureKey} = {JSON.stringify(row.entitlementValue)} · from{" "}
                {new Date(row.effectiveFromAt).toLocaleDateString()}
                {row.contractReference ? ` · ${row.contractReference}` : ""}{" "}
                <Badge variant="outline">{row.source}</Badge>
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
