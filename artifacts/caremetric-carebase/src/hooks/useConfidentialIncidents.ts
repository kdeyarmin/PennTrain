import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type ConfidentialIntake = Tables<"confidential_incident_intakes">;
export type ConfidentialIntakeDetails = Tables<"confidential_incident_details">;
export type ConfidentialAccessEvent = Tables<"confidential_incident_access_events">;

export interface ListConfidentialIntakesFilters {
  organizationId?: string;
  facilityId?: string;
  status?: string;
  severity?: string;
}

// Intake summaries are the broadly-visible triage tier: RLS shows org_admin/auditor every
// org intake and facility-assigned staff their facilities' non-draft intakes. The protected
// narrative deliberately has NO direct read path -- it is reachable only through the
// purpose-stamped open_confidential_intake_details RPC below, so every view is auditable.
export function useListConfidentialIntakes(filters: ListConfidentialIntakesFilters = {}) {
  return useQuery({
    queryKey: ["confidential_intakes", filters],
    queryFn: async () => {
      let query = supabase
        .from("confidential_incident_intakes")
        .select("*")
        .order("reported_at", { ascending: false });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.severity) query = query.eq("severity", filters.severity);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetConfidentialIntake(id: string | undefined) {
  return useQuery({
    queryKey: ["confidential_intakes", "detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("confidential_incident_intakes")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

// The access ledger is append-only and readable by org_admin/auditor (RLS); other roles
// simply see no rows.
export function useListIntakeAccessEvents(intakeId: string | undefined) {
  return useQuery({
    queryKey: ["confidential_access_events", intakeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("confidential_incident_access_events")
        .select("*")
        .eq("intake_id", intakeId!)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!intakeId,
  });
}

// Every call stamps a view_details access event server-side; the purpose is mandatory
// (>= 5 chars) and becomes part of the permanent ledger.
export function useOpenIntakeDetails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ intakeId, purpose }: { intakeId: string; purpose: string }) => {
      const { data, error } = await supabase.rpc("open_confidential_intake_details", {
        p_intake_id: intakeId,
        p_purpose: purpose,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as ConfidentialIntakeDetails | null;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["confidential_access_events"] }),
  });
}

export function useSetIntakeStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ intakeId, targetStatus, reason }: { intakeId: string; targetStatus: string; reason: string }) => {
      const { data, error } = await supabase.rpc("set_confidential_intake_status", {
        p_intake_id: intakeId,
        p_target_status: targetStatus,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["confidential_intakes"] });
      queryClient.invalidateQueries({ queryKey: ["confidential_access_events"] });
      queryClient.invalidateQueries({ queryKey: ["closed-loop-compliance"] });
    },
  });
}

export interface RevealedReporterIdentity {
  reporterMode: string;
  identityOnFile: boolean;
  reporterProfileId?: string | null;
  reporterName?: string | null;
  reporterEmail?: string | null;
  encryptedContact?: Json;
  consentToContact?: boolean;
  recordedAt?: string;
}

// org_admin (or platform_admin) with a fresh AAL2 session only; always stamps a
// view_identity access event, including for anonymous intakes.
export function useRevealReporterIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ intakeId, purpose }: { intakeId: string; purpose: string }) => {
      const { data, error } = await supabase.rpc("reveal_confidential_reporter_identity", {
        p_intake_id: intakeId,
        p_purpose: purpose,
      });
      if (error) throw error;
      return data as unknown as RevealedReporterIdentity;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["confidential_access_events"] }),
  });
}
