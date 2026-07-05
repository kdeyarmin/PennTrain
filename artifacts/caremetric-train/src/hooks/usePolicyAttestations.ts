import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type PolicyAttestationCampaign = Tables<"policy_attestation_campaigns">;
export type PolicyAttestationCampaignInsert = TablesInsert<"policy_attestation_campaigns">;
export type PolicyAttestation = Tables<"policy_attestations">;

export interface ListPolicyAttestationCampaignsFilters {
  organizationId?: string;
  policyDocumentId?: string;
}

export function useListPolicyAttestationCampaigns(filters: ListPolicyAttestationCampaignsFilters = {}) {
  return useQuery({
    queryKey: ["policy_attestation_campaigns", filters],
    queryFn: async () => {
      let query = supabase.from("policy_attestation_campaigns").select("*").order("created_at", { ascending: false });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.policyDocumentId) query = query.eq("policy_document_id", filters.policyDocumentId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetPolicyAttestationCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ["policy_attestation_campaigns", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("policy_attestation_campaigns").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreatePolicyAttestationCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PolicyAttestationCampaignInsert) => {
      const { data, error } = await supabase.from("policy_attestation_campaigns").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policy_attestation_campaigns"] }),
  });
}

export function useDeletePolicyAttestationCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // policy_attestations.campaign_id is ON DELETE CASCADE -- deleting a campaign drops every
      // per-employee attestation row it created, including any already-attested (signed) ones.
      // That's an audit-trail-destroying action, so the calling page should gate this behind a
      // clear confirmation rather than a bare click.
      const { error } = await supabase.from("policy_attestation_campaigns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policy_attestation_campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["policy_attestations"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Per-employee attestation rows.
//
// Assigning a campaign to a roster fans out the same two-level way
// useApplyTrainingPlanToEmployee/TrainingPlans.tsx already does: this hook
// creates ONE attestation for ONE employee; the calling page (PolicyDocuments
// campaign dialog) loops selected employees with Promise.allSettled. There's
// no per-employee "multiple items" level here (a campaign is exactly one
// policy version), so the hook itself needs no inner fan-out loop.
//
// organization_id/facility_id are supplied by the caller (same convention as
// useCreateEmployeeCredential's call site: the calling page reads them off the
// selected employee record) -- stamp_scope_from_employee_for_attestation()
// (BEFORE INSERT trigger) then unconditionally re-derives both from
// employee_id and overwrites whatever was passed, so a caller can't put an
// attestation in the wrong org/facility even if it got these wrong.
// ---------------------------------------------------------------------------

export interface ListPolicyAttestationsFilters {
  campaignId?: string;
  employeeId?: string;
  status?: PolicyAttestation["status"];
}

export function useListPolicyAttestations(filters: ListPolicyAttestationsFilters = {}) {
  return useQuery({
    queryKey: ["policy_attestations", filters],
    queryFn: async () => {
      let query = supabase.from("policy_attestations").select("*").order("due_date", { ascending: true, nullsFirst: false });
      if (filters.campaignId) query = query.eq("campaign_id", filters.campaignId);
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export interface AssignPolicyAttestationParams {
  campaignId: string;
  employeeId: string;
  organizationId: string;
  facilityId: string;
  policyDocumentVersionId: string;
  dueDate?: string | null;
}

export function useAssignPolicyAttestationToEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: AssignPolicyAttestationParams) => {
      const { data, error } = await supabase
        .from("policy_attestations")
        .insert({
          campaign_id: params.campaignId,
          employee_id: params.employeeId,
          organization_id: params.organizationId,
          facility_id: params.facilityId,
          policy_document_version_id: params.policyDocumentVersionId,
          due_date: params.dueDate ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["policy_attestations"] });
      queryClient.invalidateQueries({ queryKey: ["policy_attestation_campaigns", data.campaign_id] });
    },
  });
}

interface AttestPolicyResponse {
  success?: boolean;
  error?: string;
  attestation?: { id: string; status: string; attested_at: string };
}

// Routes through the attest-policy Edge Function rather than a plain RPC/table update -- there
// is deliberately no "update" RLS policy on policy_attestations for authenticated users, so this
// is the only way an attestation can move from pending to attested. The function captures IP/
// User-Agent from the request itself (unavailable to a plain Postgres RPC), which is what makes
// the resulting row an ESIGN/UETA-adequate record of intent, consent, and attribution.
export function useAttestPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (attestationId: string) => {
      const { data, error } = await supabase.functions.invoke<AttestPolicyResponse>("attest-policy", {
        body: { attestationId },
      });
      if (error) throw error;
      if (!data || data.success === false || !data.attestation) {
        throw new Error(data?.error ?? "Failed to record attestation");
      }
      return data.attestation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policy_attestations"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
