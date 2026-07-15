import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ViolationDocument = Tables<"violation_documents">;

export function useListViolationDocuments(violationId: string | undefined) {
  return useQuery({
    queryKey: ["violation_documents", violationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("violation_documents").select("*").eq("violation_id", violationId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!violationId,
  });
}

export interface UploadViolationDocumentInput {
  file: File;
  organizationId: string;
  facilityId: string;
  violationId: string;
  documentLabel?: string;
}

export function useUploadViolationDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, organizationId, facilityId, violationId, documentLabel }: UploadViolationDocumentInput) => {
      const path = `${organizationId}/${facilityId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("violation-documents").upload(path, file);
      if (uploadError) throw uploadError;

      // organization_id/facility_id are re-derived server-side from violation_id by
      // stamp_scope_from_violation() -- the values passed here just satisfy the not-null columns.
      const { data, error } = await supabase
        .from("violation_documents")
        .insert({
          organization_id: organizationId,
          facility_id: facilityId,
          violation_id: violationId,
          file_name: file.name,
          storage_path: path,
          file_type: file.type,
          file_size: file.size,
          document_label: documentLabel ?? null,
          document_type: "evidence",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["violation_documents", variables.violationId] }),
  });
}

export function useViolationDocumentSignedUrl() {
  return useMutation({
    mutationFn: async (doc: ViolationDocument) => {
      const { error: logError } = await supabase.rpc("log_document_access", {
        p_document_table: "violation_documents",
        p_document_id: doc.id,
      });
      if (logError) throw logError;
      const { data, error } = await supabase.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function useDeleteViolationDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: ViolationDocument) => {
      const { error: storageError } = await supabase.storage.from(doc.storage_bucket).remove([doc.storage_path]);
      if (storageError) throw storageError;
      const { error } = await supabase.from("violation_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: (_data, doc) => queryClient.invalidateQueries({ queryKey: ["violation_documents", doc.violation_id] }),
  });
}
