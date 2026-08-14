import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";
export { extractedFieldString, renewalSlaLabel } from "@/lib/credentialRenewals";

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
        // Unique tie-break: submissions the renewal job creates in one pass share a `created_at`,
        // so without it a page boundary inside that run can repeat one submission and hide
        // another.
        .order("id", { ascending: true })
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
      // "credential-renewal-queue-summary" is a SEPARATE root, not a suffix of the key above --
      // TanStack matches key elements, so invalidating the submissions list leaves the summary
      // untouched. get_credential_renewal_queue_summary counts exactly what a decision changes
      // (needsReview / uploaded / overdue buckets), and the query holds staleTime: 30_000, so the
      // reviewer approved or rejected an item and watched the queue tiles keep the pre-decision
      // counts.
      client.invalidateQueries({ queryKey: ["credential-renewal-queue-summary"] });
      client.invalidateQueries({ queryKey: ["qualified-workforce"] });
      client.invalidateQueries({ queryKey: ["employee_credentials"] });
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
      // A new submission lands in the queue's "uploaded"/"needsReview" buckets, so the same
      // separate-root summary has to be refreshed here too.
      client.invalidateQueries({ queryKey: ["credential-renewal-queue-summary"] });
    },
  });
}


export interface CredentialRenewalQueueSummary {
  needsReview: number;
  uploaded: number;
  overdue24h: number;
  overdue72h: number;
  generatedAt: string;
}

export function useCredentialRenewalQueueSummary() {
  return useQuery({
    queryKey: ["credential-renewal-queue-summary"],
    queryFn: async (): Promise<CredentialRenewalQueueSummary> => {
      const { data, error } = await supabase.rpc("get_credential_renewal_queue_summary");
      if (error) throw error;
      const raw = (data ?? {}) as Record<string, unknown>;
      return {
        needsReview: Number(raw.needsReview ?? 0),
        uploaded: Number(raw.uploaded ?? 0),
        overdue24h: Number(raw.overdue24h ?? 0),
        overdue72h: Number(raw.overdue72h ?? 0),
        generatedAt: String(raw.generatedAt ?? new Date().toISOString()),
      };
    },
    staleTime: 30_000,
  });
}

