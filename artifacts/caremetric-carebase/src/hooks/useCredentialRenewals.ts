import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";
export { extractedFieldString } from "@/lib/credentialRenewals";

export type CredentialRenewalSubmission = Tables<"credential_renewal_submissions">;

export interface CredentialRenewalFilters {
  status?: string;
  page?: number;
  pageSize?: number;
}

export function useCredentialRenewalSubmissions(filters: CredentialRenewalFilters = {}) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 50;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  return useQuery({
    queryKey: ["credential-renewal-submissions", filters],
    queryFn: async () => {
      let query = supabase
        .from("credential_renewal_submissions")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (filters.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data as CredentialRenewalSubmission[], total: count ?? 0 };
    },
  });
}

export interface ReviewCredentialRenewalInput {
  submissionId: string;
  decision: "approve" | "reject";
  reason: string;
  confirmedFields: {
    issuingAuthority?: string;
    expirationDate?: string;
    issueDate?: string;
    credentialNumber?: string;
    credentialLabel?: string;
  };
}

export function useReviewCredentialRenewal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReviewCredentialRenewalInput) => {
      const { data, error } = await supabase.rpc("review_credential_renewal_submission", {
        p_submission_id: input.submissionId,
        p_decision: input.decision,
        p_confirmed_fields: input.confirmedFields as Json,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["credential-renewal-submissions"] });
      client.invalidateQueries({ queryKey: ["qualified-workforce"] });
      client.invalidateQueries({ queryKey: ["employee-credentials"] });
    },
  });
}

export interface CreateCredentialRenewalInput {
  employeeId: string;
  credentialId: string;
  credentialDocumentId: string;
  credentialType: string;
}

export function useCreateCredentialRenewalSubmission() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCredentialRenewalInput) => {
      const { data, error } = await supabase.rpc("create_credential_renewal_submission", {
        p_employee_id: input.employeeId,
        p_credential_id: input.credentialId,
        p_credential_document_id: input.credentialDocumentId,
        p_credential_type: input.credentialType,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["credential-renewal-submissions"] });
    },
  });
}

