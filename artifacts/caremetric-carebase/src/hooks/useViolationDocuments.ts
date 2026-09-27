import { deleteDocumentWithReceipt } from "@/lib/documentDeletion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import { storageSafeFileName } from "@/lib/storagePaths";
import { recoverUploadedWrite } from "@/lib/uploadWriteRecovery";

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
      const path = `${organizationId}/${facilityId}/${crypto.randomUUID()}-${storageSafeFileName(file.name)}`;
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
      if (error) {
        return recoverUploadedWrite<ViolationDocument>({ error,
          read: () => supabase.from("violation_documents").select("*")
            .eq("organization_id", organizationId).eq("violation_id", violationId)
            .eq("storage_bucket", "violation-documents").eq("storage_path", path).maybeSingle(),
          remove: () => supabase.storage.from("violation-documents").remove([path]),
        });
      }
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
    mutationFn: (doc: ViolationDocument) => deleteDocumentWithReceipt("violation", doc.id),
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["violation_documents"] }),
      queryClient.invalidateQueries({ queryKey: ["document_deletions"] }),
    ]),
  });
}
