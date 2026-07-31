import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ReleaseFlag = Tables<"release_flags">;
export type ReleaseCohort = Tables<"release_cohorts">;
export type OrgReleaseCohort = Tables<"organization_release_cohorts">;
export type FeatureKillSwitch = Tables<"feature_kill_switches">;
export type FeatureDefinition = Tables<"feature_definitions">;

export function useReleaseCohorts() {
  return useQuery({
    queryKey: ["release_cohorts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("release_cohorts")
        .select("*")
        .order("cohort_key");
      if (error) throw error;
      return data as ReleaseCohort[];
    },
    staleTime: 30_000,
  });
}

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

export function useOrgReleaseCohortMemberships(cohortId?: string) {
  return useQuery({
    queryKey: ["organization_release_cohorts", cohortId ?? "all"],
    queryFn: async () => {
      let query = supabase
        .from("organization_release_cohorts")
        .select("*, organization:organizations(id, name, is_demo, slug)")
        .order("assigned_at", { ascending: false })
        .limit(500);
      if (cohortId) query = query.eq("cohort_id", cohortId);
      const { data, error } = await query;
      if (error) throw error;
      return data as Array<
        OrgReleaseCohort & {
          organization: { id: string; name: string; is_demo: boolean | null; slug: string } | null;
        }
      >;
    },
    staleTime: 15_000,
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

export function useAssignOrgToReleaseCohort() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      cohortId: string;
      featureKey: string;
      reason: string;
      expiresAt?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("assign_organization_release_cohort", {
        p_organization_id: input.organizationId,
        p_cohort_id: input.cohortId,
        p_feature_key: input.featureKey,
        p_reason: input.reason,
        p_expires_at: input.expiresAt ?? undefined,
      });
      if (error) throw new Error(aal2Hint(error.message));
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["organization_release_cohorts"] });
    },
  });
}

export function useUnassignOrgFromReleaseCohort() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      cohortId: string;
      featureKey: string;
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("unassign_organization_release_cohort", {
        p_organization_id: input.organizationId,
        p_cohort_id: input.cohortId,
        p_feature_key: input.featureKey,
        p_reason: input.reason,
      });
      if (error) throw new Error(aal2Hint(error.message));
      return data as boolean;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["organization_release_cohorts"] });
    },
  });
}

export function useSetReleaseFlag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      featureKey: string;
      rolloutMode: "off" | "cohort" | "global";
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
