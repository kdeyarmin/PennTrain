import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type CredentialDocument = Tables<"employee_credential_documents">;

export interface ListCredentialDocumentsFilters {
  employeeId?: string;
  credentialId?: string;
}

export function useListCredentialDocuments(filters: ListCredentialDocumentsFilters = {}) {
  return useQuery({
    queryKey: ["credential_documents", filters],
    queryFn: async () => {
      let query = supabase.from("employee_credential_documents").select("*").order("created_at", { ascending: false });
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.credentialId) query = query.eq("credential_id", filters.credentialId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export interface UploadCredentialDocumentInput {
  file: File;
  organizationId: string;
  facilityId: string;
  employeeId: string;
  credentialId: string;
  documentLabel?: string;
}

export function useUploadCredentialDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, organizationId, facilityId, employeeId, credentialId, documentLabel }: UploadCredentialDocumentInput) => {
      const path = `${organizationId}/${facilityId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("credential-documents").upload(path, file);
      if (uploadError) throw uploadError;

      // organization_id/facility_id/employee_id are re-derived server-side from credential_id
      // by stamp_scope_from_credential() -- the values passed here just satisfy the not-null
      // columns and are overwritten before the RLS check runs.
      const { data, error } = await supabase
        .from("employee_credential_documents")
        .insert({
          organization_id: organizationId,
          facility_id: facilityId,
          employee_id: employeeId,
          credential_id: credentialId,
          file_name: file.name,
          storage_path: path,
          file_type: file.type,
          file_size: file.size,
          document_label: documentLabel ?? null,
        })
        .select()
        .single();
      if (error) {
        await supabase.storage.from("credential-documents").remove([path]);
        throw error;
      }
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["credential_documents"] }),
  });
}

// Storage signed-URL downloads don't pass through table RLS, so this logs the access via
// log_document_access() (a security-definer RPC that re-checks authorization itself) before
// requesting the signed URL, giving credential-document reads an audit trail like every write
// already has.
export function useCredentialDocumentSignedUrl() {
  return useMutation({
    mutationFn: async (doc: CredentialDocument) => {
      const { error: logError } = await supabase.rpc("log_document_access", {
        p_document_table: "employee_credential_documents",
        p_document_id: doc.id,
      });
      if (logError) throw logError;
      const { data, error } = await supabase.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function useDeleteCredentialDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: CredentialDocument) => {
      const { error: storageError } = await supabase.storage.from(doc.storage_bucket).remove([doc.storage_path]);
      if (storageError) throw storageError;
      const { error } = await supabase.from("employee_credential_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["credential_documents"] }),
  });
}
