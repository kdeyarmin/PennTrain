/**
 * Duty eligibility, and the override that was documented but unreachable (BACKLOG.md G12.4).
 *
 * `evaluate_duty_eligibility` decides whether somebody may sign an assessment, observe a practicum
 * or evaluate a competency, and two server paths refuse the action when it says no. What had no way
 * in was `grant_duty_eligibility_override` -- the supervisor's documented answer to "I know, and I
 * am accepting the risk, in writing, with an expiry". Without it a blocked person could only be
 * unblocked by changing the underlying record, which is right for a missing credential and wrong
 * for a judgement call the rule cannot see.
 *
 * `src/lib/dutyEligibility.ts` had modelled all of this from the start -- `overrideId`, and an
 * `overridable` flag per reason -- and had no consumer at all. This is that consumer.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DutyEligibilityResult } from "@/lib/dutyEligibility";

/** The three duties the rules cover. Values are the server's `duty_key`s. */
export const DUTY_KEYS = [
  { key: "resident_assessor", label: "Sign resident assessments" },
  { key: "practicum_observer", label: "Observe practicums" },
  { key: "competency_evaluator", label: "Evaluate competencies" },
] as const;

export type DutyKey = (typeof DUTY_KEYS)[number]["key"];

export function useDutyEligibility(
  profileId: string | null | undefined,
  dutyKey: DutyKey,
  facilityId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["duty-eligibility", profileId ?? null, dutyKey, facilityId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("evaluate_duty_eligibility" as never, {
        p_profile_id: profileId!,
        p_duty_key: dutyKey,
        p_facility_id: facilityId!,
      } as never);
      if (error) throw error;
      return data as unknown as DutyEligibilityResult;
    },
    enabled: !!profileId && !!facilityId,
  });
}

export interface DutyOverrideRow {
  id: string;
  duty_key: string;
  reason: string;
  expires_at: string;
  created_at: string;
  granted_by: string | null;
}

/**
 * Overrides already on this person, newest first.
 *
 * Reads the table rather than an RPC: `duty_eligibility_overrides_select` already scopes rows to
 * the caller's organization, and the surface needs the rows, not a count.
 */
export function useDutyEligibilityOverrides(profileId: string | null | undefined) {
  return useQuery({
    queryKey: ["duty-eligibility-overrides", profileId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("duty_eligibility_overrides")
        .select("id, duty_key, reason, expires_at, created_at, granted_by")
        .eq("profile_id", profileId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DutyOverrideRow[];
    },
    enabled: !!profileId,
  });
}

export function useGrantDutyEligibilityOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      profileId: string;
      dutyKey: DutyKey;
      facilityId: string;
      reason: string;
      expiresAt: string;
    }) => {
      const { data, error } = await supabase.rpc("grant_duty_eligibility_override" as never, {
        p_profile_id: input.profileId,
        p_duty_key: input.dutyKey,
        p_facility_id: input.facilityId,
        p_reason: input.reason,
        p_expires_at: input.expiresAt,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["duty-eligibility"] }),
        queryClient.invalidateQueries({ queryKey: ["duty-eligibility-overrides"] }),
      ]);
    },
  });
}
