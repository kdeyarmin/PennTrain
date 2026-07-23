import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type PlatformSetting = Tables<"platform_settings">;

export function useListPlatformSettings() {
  return useQuery({
    queryKey: ["platform_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_settings").select("*");
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdatePlatformSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean | number }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("platform_settings")
        .update({ value, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
        .eq("key", key)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform_settings"] });
      // Also refresh the public platform-status cache so the admin's own maintenance banner/gate
      // (and anything else reading usePlatformStatus in this tab) reflects the change immediately.
      queryClient.invalidateQueries({ queryKey: ["platform-status"] });
    },
  });
}

interface PlatformStatus {
  maintenanceMode: boolean;
  signupEnabled: boolean;
}

const PLATFORM_STATUS_FALLBACK: PlatformStatus = { maintenanceMode: false, signupEnabled: true };

/**
 * Public, pre-auth-safe status check -- backs the maintenance banner and the /signup page, both
 * of which need to know these two flags before there is any authenticated session (and therefore
 * before RLS on platform_settings, which is platform_admin-only, would let a direct select
 * through). Calls the public get-platform-status Edge Function instead of querying the table
 * directly. Must never throw: any failure (network, function error, unexpected shape) is caught
 * here and resolved to the safe fallback so this can never block the rest of the app.
 */
export function usePlatformStatus() {
  return useQuery({
    queryKey: ["platform-status"],
    queryFn: async (): Promise<PlatformStatus> => {
      try {
        const { data, error } = await supabase.functions.invoke<Partial<PlatformStatus>>("get-platform-status");
        if (error || !data) return PLATFORM_STATUS_FALLBACK;
        return {
          maintenanceMode: data.maintenanceMode ?? PLATFORM_STATUS_FALLBACK.maintenanceMode,
          signupEnabled: data.signupEnabled ?? PLATFORM_STATUS_FALLBACK.signupEnabled,
        };
      } catch {
        return PLATFORM_STATUS_FALLBACK;
      }
    },
    staleTime: 60000,
    // Poll so that turning maintenance mode on actually holds already-open, non-admin sessions out
    // within about a minute (react-query has no cross-client push; the settings mutation only
    // invalidates the admin's own tab). refetchOnWindowFocus (default) covers tab re-focus sooner.
    refetchInterval: 60000,
  });
}
