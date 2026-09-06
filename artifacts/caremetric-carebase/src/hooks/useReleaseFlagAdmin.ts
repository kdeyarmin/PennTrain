import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import { privilegedFailureMessage, privilegedSessionExpired } from "@/lib/edgeFunctionErrors";

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

// A refusal here is one of two very different things and this used to give both the same advice.
// An EXPIRED privileged window (SQLSTATE 42501, "A fresh AAL2 session is required for operation
// ...") mentions "aal", so it matched the keyword sniff below and was answered with "Open Account
// security to complete MFA step-up" -- which cannot work, because the window is measured from the
// Auth session's own created_at and a step-up does not reset it. Only a genuine "you have not
// verified a second factor" keeps the hint.
function aal2Hint(error: unknown): string {
  const message = privilegedFailureMessage(error);
  if (privilegedSessionExpired(error)) return message;
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
      if (error) throw new Error(aal2Hint(error));
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
      if (error) throw new Error(aal2Hint(error));
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["feature_kill_switches"] });
      client.invalidateQueries({ queryKey: ["feature_release"] });
    },
  });
}

// --- Cohort membership (BACKLOG.md G12.1, G15.1) ------------------------------------------------
//
// `20260802030000_remove_pilot_program.sql` deleted the pilot cohort console and said "the general
// release-flag / cohort / kill-switch mechanism itself is untouched". The mechanism survived; its
// only two entry points did not. `unassign_organization_release_cohort` was dropped outright (this
// branch restored it), and `assign_organization_release_cohort` kept its grant and lost its caller
// -- which nothing noticed, because the gate was reading multi-function grants a line at a time.
//
// So both sides are dormant and the tables are intact: an organization cannot be put into a release
// cohort, nor taken out of one. This is wired on the existing release-flags page, beside the flags
// and kill switches it belongs with -- NOT as a re-creation of the pilot console that migration
// deliberately removed.

export interface ReleaseCohort {
  id: string;
  cohort_key: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface OrganizationCohortMembership {
  id: string;
  organization_id: string;
  cohort_id: string;
  feature_key: string;
  assigned_at: string;
  expires_at: string | null;
  reason: string | null;
}

export function useReleaseCohorts() {
  return useQuery({
    queryKey: ["release-cohorts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("release_cohorts")
        .select("id,cohort_key,name,description,is_active")
        .order("name");
      if (error) throw error;
      return (data ?? []) as ReleaseCohort[];
    },
  });
}

export function useOrganizationCohortMemberships() {
  return useQuery({
    queryKey: ["organization-release-cohorts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_release_cohorts")
        .select("id,organization_id,cohort_id,feature_key,assigned_at,expires_at,reason")
        .order("assigned_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OrganizationCohortMembership[];
    },
  });
}

function useCohortMutation<TArgs>(run: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization-release-cohorts"] }),
  });
}

export function useAssignOrganizationCohort() {
  return useCohortMutation(async (input: {
    organizationId: string; cohortId: string; featureKey: string; reason: string; expiresAt?: string;
  }) => {
    const { error } = await supabase.rpc("assign_organization_release_cohort" as never, {
      p_organization_id: input.organizationId,
      p_cohort_id: input.cohortId,
      p_feature_key: input.featureKey,
      p_reason: input.reason,
      ...(input.expiresAt ? { p_expires_at: input.expiresAt } : {}),
    } as never);
    if (error) throw error;
    return true;
  });
}

export function useUnassignOrganizationCohort() {
  return useCohortMutation(async (input: {
    organizationId: string; cohortId: string; featureKey: string; reason: string;
  }) => {
    const { error } = await supabase.rpc("unassign_organization_release_cohort" as never, {
      p_organization_id: input.organizationId,
      p_cohort_id: input.cohortId,
      p_feature_key: input.featureKey,
      p_reason: input.reason,
    } as never);
    if (error) throw error;
    return true;
  });
}
