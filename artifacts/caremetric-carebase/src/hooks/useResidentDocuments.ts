import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import { useAuth } from "@/lib/auth";
import { describeFunctionError } from "./useResidentAssessmentForms";
import { storageSafeFileName } from "@/lib/storagePaths";
import { hasDefinitivePostgresWriteRejection } from "@/lib/postgresWriteOutcome";

export type ResidentDocument = Tables<"resident_documents">;

export function useListResidentDocuments(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident_documents", residentId],
    queryFn: async ({ signal }) => {
      const pageSize = 1000;
      const rows: ResidentDocument[] = [];
      for (let from = 0; ;) {
        const { data, error } = await supabase
          .from("resident_documents").select("*").eq("resident_id", residentId!)
          .order("created_at", { ascending: false }).order("id", { ascending: true })
          .range(from, from + pageSize - 1).abortSignal(signal);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data?.length) return rows;
        from += data.length;
      }
    },
    enabled: !!residentId,
  });
}

export interface UploadResidentDocumentInput {
  file: File;
  organizationId: string;
  facilityId: string;
  residentId: string;
  complianceItemId?: string;
  documentLabel?: string;
  /**
   * True only when `file` IS the actual DHS-prescribed form (RASP/ASP, DME, Preadmission
   * Screening, etc.) as completed by facility staff -- never set for CareMetric-generated
   * reference PDFs. Eligible assessment/support forms may instead carry a documented
   * equivalentFormReview. Ordinary reference uploads carry neither designation.
   */
  isStateForm?: boolean;
  stateFormSourceLabel?: string;
  stateFormSourceUrl?: string;
  equivalentFormReview?: { all_required_information: true; reviewer_name: string; review_reference: string };
}

export function useUploadResidentDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, organizationId, facilityId, residentId, complianceItemId, documentLabel, isStateForm, stateFormSourceLabel, stateFormSourceUrl, equivalentFormReview }: UploadResidentDocumentInput) => {
      if (isStateForm && !stateFormSourceLabel) {
        throw new Error("State-form uploads must include the official PA DHS source label.");
      }
      const path = `${organizationId}/${facilityId}/${crypto.randomUUID()}-${storageSafeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from("resident-documents").upload(path, file);
      if (uploadError) throw uploadError;

      // organization_id/facility_id are re-derived server-side from resident_id by
      // stamp_scope_from_resident() -- the values passed here just satisfy the not-null columns.
      const { data, error } = await supabase
        .from("resident_documents")
        .insert({
          organization_id: organizationId,
          facility_id: facilityId,
          resident_id: residentId,
          compliance_item_id: complianceItemId ?? null,
          file_name: file.name,
          storage_path: path,
          file_type: file.type,
          file_size: file.size,
          document_label: documentLabel ?? null,
          is_state_form: isStateForm ?? false,
          state_form_source_label: stateFormSourceLabel ?? null,
          state_form_source_url: stateFormSourceUrl ?? null,
          equivalent_form_review: equivalentFormReview ?? null,
        })
        .select()
        .single();
      if (error) {
        // An error response can arrive after the metadata committed. Reconcile this
        // exact upload before cleanup; an empty read cannot disprove a late commit.
        const unknown = new Error("The document save could not be confirmed. The uploaded file was retained; refresh the document list before retrying.");
        let saved: ResidentDocument | null;
        try {
          const result = await supabase.from("resident_documents").select("*")
            .eq("organization_id", organizationId).eq("resident_id", residentId)
            .eq("storage_bucket", "resident-documents").eq("storage_path", path).maybeSingle();
          if (result.error) throw result.error;
          saved = result.data;
        } catch { throw unknown; }
        if (saved) return saved;
        if (!hasDefinitivePostgresWriteRejection(error)) throw unknown;
        try {
          const { error: cleanupError } = await supabase.storage.from("resident-documents").remove([path]);
          if (cleanupError) throw cleanupError;
        } catch {
          throw new Error(`${error.message} (the uploaded file could not be removed; refresh the document list before retrying)`);
        }
        throw error;
      }
      return data;
    },
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["resident_documents", variables.residentId] }),
  });
}

export interface GeneratedStateFormPrefill {
  success?: boolean;
  error?: string;
  url?: string;
  documentId?: string;
  fieldsFilled?: number;
}

// Downloads the official DHS PDF for an upload-only item (preadmission screening / DME) with the
// resident's demographics prefilled -- a "start from this" drafting aid stored is_state_form=false,
// never completion documentation. Idempotent server-side: a second call returns the existing document.
export function useGenerateStateFormPrefill() {
  const queryClient = useQueryClient();
  return useMutation({
    // residentId is only consumed by onSettled's targeted invalidation.
    mutationFn: async ({ complianceItemId }: { complianceItemId: string; residentId: string }) => {
      const { data, error } = await supabase.functions.invoke<GeneratedStateFormPrefill>(
        "generate-state-form-prefill",
        { body: { complianceItemId } },
      );
      if (error) throw new Error(await describeFunctionError(error, "Failed to generate the prefilled form"));
      if (!data || data.success === false) throw new Error(data?.error ?? "Failed to generate the prefilled form");
      return data;
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ["resident_documents", variables.residentId] });
    },
  });
}

export function useResidentDocumentSignedUrl() {
  return useMutation({
    mutationFn: async (doc: ResidentDocument) => {
      const { error: logError } = await supabase.rpc("log_document_access", {
        p_document_table: "resident_documents",
        p_document_id: doc.id,
      });
      if (logError) throw logError;
      const { data, error } = await supabase.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function useDeleteResidentDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: ResidentDocument) => {
      // Retention checks and a durable cleanup receipt commit before any bytes go.
      const { data, error } = await supabase.rpc("begin_resident_document_deletion", { p_document_id: doc.id });
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("The document could not be deleted. Refresh the list and try again.");
      await finishResidentDocumentDeletion(data[0]);
    },
    onSettled: (_data, _error, doc) => {
      queryClient.invalidateQueries({ queryKey: ["resident_documents", doc.resident_id] });
      queryClient.invalidateQueries({ queryKey: ["resident_document_deletions"] });
      queryClient.invalidateQueries({ queryKey: ["resident_record_destructions"] });
    },
  });
}

export type PendingResidentDocumentDeletion = {
  document_id: string;
  resident_id: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  requested_at: string;
};

async function finishResidentDocumentDeletion(doc: Pick<PendingResidentDocumentDeletion, "document_id" | "storage_bucket" | "storage_path">) {
  // A lost Storage response can still mean deletion succeeded. The server confirms
  // absence independently, also catching remove() success with zero RLS-visible rows.
  try { await supabase.storage.from(doc.storage_bucket).remove([doc.storage_path]); } catch { /* confirm below */ }
  const { data, error } = await supabase.rpc("confirm_resident_document_deletion", { p_document_id: doc.document_id });
  if (error || data !== true) {
    throw new Error("The document record was removed, but file deletion is still pending. Use Retry deletion in this resident's Documents tab.");
  }
}

export function useListPendingResidentDocumentDeletions(residentId: string | undefined, enabled: boolean) {
  const { user, isLoading } = useAuth();
  return useQuery({
    queryKey: ["resident_document_deletions", user?.id, user?.organizationId, user?.role, user?.facilityId, residentId ?? "all"],
    queryFn: async ({ signal }) => {
      const rows: PendingResidentDocumentDeletion[] = [];
      for (let from = 0; ;) {
        const { data, error } = await supabase.rpc("list_pending_resident_document_deletions", residentId ? { p_resident_id: residentId } : {})
          .range(from, from + 499).abortSignal(signal);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data?.length) return rows;
        from += data.length;
      }
    },
    enabled: enabled && !isLoading && !!user?.isActive,
  });
}

export function useRetryResidentDocumentDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (doc: PendingResidentDocumentDeletion) => finishResidentDocumentDeletion(doc),
    onSettled: (_data, _error, doc) => {
      queryClient.invalidateQueries({ queryKey: ["resident_document_deletions"] });
      queryClient.invalidateQueries({ queryKey: ["resident_record_destructions"] });
    },
  });
}
