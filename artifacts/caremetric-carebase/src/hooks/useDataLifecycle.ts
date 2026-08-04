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

export interface AuditExportManifest {
  rowCount: number;
  sha256: string;
}

/**
 * What an archive of this range would contain, before planning one (BACKLOG.md G11).
 *
 * `plan_audit_archive` calls this itself and stores the result, so previewing with the same function
 * means the number on screen is the number that gets recorded rather than a second estimate.
 */
export function useAuditExportManifest(range: { from: string; to: string; organizationId: string | null }) {
  return useQuery({
    queryKey: ["audit_export_manifest", range.from, range.to, range.organizationId],
    queryFn: async (): Promise<AuditExportManifest> => {
      const { data, error } = await supabase.rpc("get_audit_export_manifest", {
        p_from: range.from,
        p_to: range.to,
        p_organization_id: (range.organizationId ?? null) as string,
      });
      if (error) throw error;
      const raw = (data ?? {}) as Record<string, unknown>;
      return { rowCount: Number(raw.rowCount ?? 0), sha256: String(raw.sha256 ?? "") };
    },
    enabled: Boolean(range.from && range.to),
    staleTime: 15_000,
  });
}

/**
 * Plan an audit archive batch (BACKLOG.md G11).
 *
 * `plan_audit_archive` had no caller anywhere. It is the only writer of
 * `app_private.audit_archive_batches`, so the export half of the retention story had no beginning:
 * lifecycle policies could archive and delete rows on their own schedule, but the deliberate
 * "freeze this range, hash it, and record whether a legal hold covers it" step could not be taken.
 *
 * The legal-hold answer is the reason to plan before exporting. The function records
 * `legal_hold_applies` on the batch rather than refusing, so the planner learns the range is frozen
 * at the point they can still do something about it.
 */
export function usePlanAuditArchive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { from: string; to: string; organizationId?: string | null }) => {
      const { data, error } = await supabase.rpc("plan_audit_archive", {
        p_from: input.from,
        p_to: input.to,
        p_organization_id: (input.organizationId ?? null) as string,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["data_lifecycle_status"] });
      client.invalidateQueries({ queryKey: ["audit-governance-status"] });
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
