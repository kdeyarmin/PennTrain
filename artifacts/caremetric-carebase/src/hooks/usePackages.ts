import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";
import type { OrganizationBillingUsage } from "@/lib/billingCatalog";

export type Package = Tables<"packages">;
export type PackageInsert = TablesInsert<"packages">;
export type PackageUpdate = TablesUpdate<"packages">;
export type PackageBillingPrice = Tables<"package_billing_prices">;
export type PackageBillingPriceInsert = TablesInsert<"package_billing_prices">;
export type PackageBillingPriceUpdate = TablesUpdate<"package_billing_prices">;

export function useListPackages() {
  return useQuery({
    queryKey: ["packages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("packages").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });
}

export function useGetPackage(id: string | null | undefined) {
  return useQuery({
    queryKey: ["packages", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("packages").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreatePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PackageInsert) => {
      const { data, error } = await supabase.from("packages").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packages"] }),
  });
}

export function useUpdatePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: PackageUpdate & { id: string }) => {
      const { data, error } = await supabase.from("packages").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packages"] }),
  });
}

export function useDeletePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("packages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packages"] }),
  });
}

export function useListPackageBillingPrices() {
  return useQuery({
    queryKey: ["package-billing-prices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_billing_prices")
        .select("*")
        .order("package_id")
        .order("sort_order")
        .order("recurring_interval");
      if (error) throw error;
      return data;
    },
  });
}

export function useOrganizationBillingUsage(organizationId: string | null | undefined) {
  return useQuery({
    queryKey: ["organization-billing-usage", organizationId],
    queryFn: async (): Promise<OrganizationBillingUsage> => {
      const { data, error } = await supabase.rpc("get_organization_billing_usage", {
        p_organization_id: organizationId!,
      });
      if (error) throw error;
      const usage = data?.[0];
      return {
        activeLearners: Number(usage?.active_learners ?? 0),
        activeUsers: Number(usage?.active_users ?? 0),
        activeResidents: Number(usage?.active_residents ?? 0),
        facilities: Number(usage?.facilities ?? 0),
      };
    },
    enabled: !!organizationId,
  });
}

export function useOrganizationBillingAccount(organizationId: string | null | undefined) {
  return useQuery({
    queryKey: ["organization-billing-account", organizationId],
    queryFn: async () => {
      const [accountResult, subscriptionResult] = await Promise.all([
        supabase
          .from("billing_accounts")
          .select("id, billing_state, stripe_customer_id")
          .eq("organization_id", organizationId!)
          .maybeSingle(),
        supabase
          .from("billing_subscriptions")
          .select("id, billing_state, package_id, current_period_end, cancel_at_period_end, quantity_sync_checked_at, quantity_sync_status, quantity_sync_error_code")
          .eq("organization_id", organizationId!)
          .in("billing_state", ["trial", "active", "grace", "past_due"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (accountResult.error) throw accountResult.error;
      if (subscriptionResult.error) throw subscriptionResult.error;
      return {
        account: accountResult.data,
        subscription: subscriptionResult.data,
      };
    },
    enabled: !!organizationId,
  });
}

export function useCreatePackageBillingPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PackageBillingPriceInsert) => {
      const { data, error } = await supabase
        .from("package_billing_prices")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["package-billing-prices"] }),
  });
}

export function useUpdatePackageBillingPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: PackageBillingPriceUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("package_billing_prices")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["package-billing-prices"] }),
  });
}

export function useDeletePackageBillingPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("package_billing_prices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["package-billing-prices"] }),
  });
}
