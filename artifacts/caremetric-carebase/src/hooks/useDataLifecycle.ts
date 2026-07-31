import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface DataLifecyclePolicyRow {
  policyKey: string;
  table: string;
  archiveAfterDays: number | null;
  deleteAfterDays: number | null;
  disposition: string;
  evidenceClass: string;
  lastRun: {
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    archived: number | null;
    deleted: number | null;
  } | null;
}

export interface DataLifecycleStatus {
  policies: DataLifecyclePolicyRow[];
  activeHolds: number;
  archiveRows: number;
  generatedAt: string;
}

export interface AuditLegalHoldRow {
  id: string;
  organization_id: string | null;
  facility_id: string | null;
  reason: string;
  starts_at: string;
  ends_at: string | null;
  released_at: string | null;
  created_by: string;
  created_at: string;
}

export function useDataLifecycleStatus() {
  return useQuery({
    queryKey: ["data_lifecycle_status"],
    queryFn: async (): Promise<DataLifecycleStatus> => {
      const { data, error } = await supabase.rpc("get_data_lifecycle_status");
      if (error) throw error;
      const raw = (data ?? {}) as Record<string, unknown>;
      return {
        policies: Array.isArray(raw.policies) ? (raw.policies as DataLifecyclePolicyRow[]) : [],
        activeHolds: Number(raw.activeHolds ?? 0),
        archiveRows: Number(raw.archiveRows ?? 0),
        generatedAt: String(raw.generatedAt ?? new Date().toISOString()),
      };
    },
    staleTime: 30_000,
  });
}

export function useListAuditLegalHolds() {
  return useQuery({
    queryKey: ["audit_legal_holds"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_audit_legal_holds");
      if (error) throw error;
      return (data ?? []) as AuditLegalHoldRow[];
    },
    staleTime: 15_000,
  });
}

export function useCreateAuditLegalHold() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      facilityId?: string | null;
      reason: string;
      endsAt?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("create_audit_legal_hold", {
        p_organization_id: input.organizationId,
        p_facility_id: (input.facilityId ?? null) as string,
        p_reason: input.reason,
        p_ends_at: input.endsAt ?? undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["audit_legal_holds"] });
      client.invalidateQueries({ queryKey: ["audit-governance-status"] });
      client.invalidateQueries({ queryKey: ["data_lifecycle_status"] });
    },
  });
}

export function useReleaseAuditLegalHold() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { holdId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("release_audit_legal_hold", {
        p_hold_id: input.holdId,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["audit_legal_holds"] });
      client.invalidateQueries({ queryKey: ["audit-governance-status"] });
      client.invalidateQueries({ queryKey: ["data_lifecycle_status"] });
    },
  });
}

export function useRunDataLifecyclePolicy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { policyKey: string; limit?: number }) => {
      const { data, error } = await supabase.rpc("run_data_lifecycle_policy", {
        p_policy_key: input.policyKey,
        p_limit: input.limit ?? 100,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["data_lifecycle_status"] });
    },
  });
}
