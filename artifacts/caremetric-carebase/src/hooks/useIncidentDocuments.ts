import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type IncidentDocument = Tables<"incident_documents">;

export function useListIncidentDocuments(incidentId: string | undefined) {
  return useQuery({
    queryKey: ["incident_documents", incidentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incident_documents").select("*").eq("incident_id", incidentId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!incidentId,
  });
}

export interface UploadIncidentDocumentInput {
  file: File;
  organizationId: string;
  facilityId: string;
  incidentId: string;
  documentLabel?: string;
}

export function useUploadIncidentDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, organizationId, facilityId, incidentId, documentLabel }: UploadIncidentDocumentInput) => {
      const path = `${organizationId}/${facilityId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("incident-documents").upload(path, file);
      if (uploadError) throw uploadError;

      // organization_id/facility_id are re-derived server-side from incident_id by
      // stamp_scope_from_incident() -- the values passed here just satisfy the not-null columns.
      const { data, error } = await supabase
        .from("incident_documents")
        .insert({
          organization_id: organizationId,
          facility_id: facilityId,
          incident_id: incidentId,
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
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["incident_documents", variables.incidentId] }),
  });
}

export function useIncidentDocumentSignedUrl() {
  return useMutation({
    mutationFn: async (doc: IncidentDocument) => {
      const { error: logError } = await supabase.rpc("log_document_access", {
        p_document_table: "incident_documents",
        p_document_id: doc.id,
      });
      if (logError) throw logError;
      const { data, error } = await supabase.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function useDeleteIncidentDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: IncidentDocument) => {
      const { error: storageError } = await supabase.storage.from(doc.storage_bucket).remove([doc.storage_path]);
      if (storageError) throw storageError;
      const { error } = await supabase.from("incident_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: (_data, doc) => queryClient.invalidateQueries({ queryKey: ["incident_documents", doc.incident_id] }),
  });
}
