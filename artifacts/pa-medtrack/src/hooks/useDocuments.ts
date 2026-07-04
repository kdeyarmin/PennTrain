import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type TrainingDocument = Tables<"training_documents">;

export interface ListDocumentsFilters {
  employeeId?: string;
  facilityId?: string;
  documentType?: string;
  /** Match any of several document_type values (e.g. the external-certificate review queue,
   * which cares about 'certificate' | 'external_certificate' | 'transcript' at once). Takes
   * precedence over `documentType` if both are supplied. */
  documentTypes?: string[];
}

export function useListDocuments(filters: ListDocumentsFilters = {}) {
  return useQuery({
    queryKey: ["documents", filters],
    queryFn: async () => {
      let query = supabase.from("training_documents").select("*").order("created_at", { ascending: false });
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.documentTypes?.length) query = query.in("document_type", filters.documentTypes);
      else if (filters.documentType) query = query.eq("document_type", filters.documentType);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetDocument(id: string | undefined) {
  return useQuery({
    queryKey: ["documents", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_documents").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export interface UploadDocumentInput {
  file: File;
  bucket: "external-uploads" | "signin-sheets" | "competency-attachments";
  organizationId: string;
  facilityId: string;
  employeeId?: string;
  trainingRecordId?: string;
  documentType: TrainingDocument["document_type"];
}

export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, bucket, organizationId, facilityId, employeeId, trainingRecordId, documentType }: UploadDocumentInput) => {
      const path = `${organizationId}/${facilityId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file);
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("training_documents")
        .insert({
          organization_id: organizationId,
          facility_id: facilityId,
          employee_id: employeeId ?? null,
          training_record_id: trainingRecordId ?? null,
          file_name: file.name,
          storage_bucket: bucket,
          storage_path: path,
          file_type: file.type,
          file_size: file.size,
          document_type: documentType,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useDocumentSignedUrl() {
  return useMutation({
    mutationFn: async (doc: TrainingDocument) => {
      const { data, error } = await supabase.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: TrainingDocument) => {
      await supabase.storage.from(doc.storage_bucket).remove([doc.storage_path]);
      const { error } = await supabase.from("training_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
}
