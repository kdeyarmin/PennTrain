import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ReleaseFlag = Tables<"release_flags">;
export type FeatureKillSwitch = Tables<"feature_kill_switches">;
export type FeatureDefinition = Tables<"feature_definitions">;

export function useReleaseFlags() {
  return useQuery({
    queryKey: ["release_flags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("release_flags")
        .select("*")
        .order("feature_key");
      if (error) throw error;
      return data as ReleaseFlag[];
    },
    staleTime: 30_000,
  });
}

export function useFeatureDefinitions() {
  return useQuery({
    queryKey: ["feature_definitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feature_definitions")
        .select("*")
        .order("feature_key");
      if (error) throw error;
      return data as FeatureDefinition[];
    },
    staleTime: 60_000,
  });
}

export function useFeatureKillSwitches() {
  return useQuery({
    queryKey: ["feature_kill_switches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feature_kill_switches")
        .select("*")
        .eq("is_disabled", true)
        .order("activated_at", { ascending: false });
      if (error) throw error;
      return data as FeatureKillSwitch[];
    },
    staleTime: 15_000,
  });
}

function aal2Hint(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("aal") || lower.includes("assurance") || lower.includes("mfa") || lower.includes("step")) {
    return `${message} Open Account security to complete MFA step-up, then retry.`;
  }
  return message;
}

export function useSetReleaseFlag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      featureKey: string;
      rolloutMode: "off" | "global";
      isEnabled: boolean;
      owner: string;
      reason: string;
      expiresAt?: string | null;
    }) => {
      const { error } = await supabase.rpc("set_release_flag", {
        p_feature_key: input.featureKey,
        p_rollout_mode: input.isEnabled ? input.rolloutMode : "off",
        p_is_enabled: input.isEnabled,
        p_owner: input.owner,
        p_reason: input.reason,
        p_expires_at: input.expiresAt ?? undefined,
      });
      if (error) throw new Error(aal2Hint(error.message));
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["release_flags"] });
      client.invalidateQueries({ queryKey: ["feature_release"] });
    },
  });
}

export function useSetFeatureKillSwitch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      featureKey: string;
      organizationId?: string | null;
      isDisabled: boolean;
      reason: string;
      expiresAt?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("set_feature_kill_switch", {
        p_feature_key: input.featureKey,
        p_organization_id: input.organizationId ?? undefined,
        p_is_disabled: input.isDisabled,
        p_reason: input.reason,
        p_expires_at: input.expiresAt ?? undefined,
      });
      if (error) throw new Error(aal2Hint(error.message));
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["feature_kill_switches"] });
      client.invalidateQueries({ queryKey: ["feature_release"] });
    },
  });
}
