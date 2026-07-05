import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ResidentDocument = Tables<"resident_documents">;

export function useListResidentDocuments(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident_documents", residentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_documents").select("*").eq("resident_id", residentId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
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
}

export function useUploadResidentDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, organizationId, facilityId, residentId, complianceItemId, documentLabel }: UploadResidentDocumentInput) => {
      const path = `${organizationId}/${facilityId}/${crypto.randomUUID()}-${file.name}`;
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
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["resident_documents", variables.residentId] }),
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
      const { error: storageError } = await supabase.storage.from(doc.storage_bucket).remove([doc.storage_path]);
      if (storageError) throw storageError;
      const { error } = await supabase.from("resident_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: (_data, doc) => queryClient.invalidateQueries({ queryKey: ["resident_documents", doc.resident_id] }),
  });
}
