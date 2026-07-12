import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type PolicyDocument = Tables<"policy_documents">;
export type PolicyDocumentInsert = TablesInsert<"policy_documents">;
export type PolicyDocumentUpdate = TablesUpdate<"policy_documents">;
export type PolicyDocumentVersion = Tables<"policy_document_versions">;

export interface ListPolicyDocumentsFilters {
  organizationId?: string;
}

export function useListPolicyDocuments(filters: ListPolicyDocumentsFilters = {}) {
  return useQuery({
    queryKey: ["policy_documents", filters],
    queryFn: async () => {
      let query = supabase.from("policy_documents").select("*").order("title");
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetPolicyDocument(id: string | undefined) {
  return useQuery({
    queryKey: ["policy_documents", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("policy_documents").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreatePolicyDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PolicyDocumentInsert) => {
      const { data, error } = await supabase.from("policy_documents").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policy_documents"] }),
  });
}

// ---------------------------------------------------------------------------
// Policy document versions -- same "course_versions" shape: draft versions can
// be edited/replaced, publishing locks the row immutable (DB trigger) and
// callers separately point policy_documents.current_version_id via a direct
// supabase.from("policy_documents").update(...) call (see
// usePublishPolicyDocumentVersion below).
//
// Versions are scoped under the "policy_documents" query-key namespace so a
// broad invalidateQueries({ queryKey: ["policy_documents"] }) also sweeps
// every document's version list via TanStack's default prefix match.
// ---------------------------------------------------------------------------

export function useListPolicyDocumentVersions(policyDocumentId: string | undefined) {
  return useQuery({
    queryKey: ["policy_documents", "versions", policyDocumentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policy_document_versions")
        .select("*")
        .eq("policy_document_id", policyDocumentId!)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!policyDocumentId,
  });
}

// Org-wide flat list (not scoped to one document) -- used by pages that need to Map-join
// version storage info onto a set of policy_attestations rows (e.g. MyAttestations.tsx), the
// same "flat select + client-side Map join" convention as courseById/employeeById elsewhere
// rather than a PostgREST embedded-resource select.
export function useListPolicyDocumentVersionsForOrg(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["policy_documents", "versions", "org", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policy_document_versions")
        .select("*")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });
}

export interface UploadPolicyDocumentVersionInput {
  file: File;
  policyDocumentId: string;
  organizationId: string;
  versionNumber: number;
  createdBy: string | null;
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function useUploadPolicyDocumentVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, policyDocumentId, organizationId, versionNumber, createdBy }: UploadPolicyDocumentVersionInput) => {
      // Hashed client-side before upload, over the exact bytes being stored -- this is the
      // "prove exactly what was signed" half of the ESIGN/UETA audit trail; attest-policy
      // stamps this same hash onto policy_attestations.document_version_hash when an employee
      // signs, so the signed record and the document content are cryptographically tied together.
      const contentHash = await sha256Hex(file);
      const path = `${organizationId}/${policyDocumentId}/v${versionNumber}-${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("policy-documents").upload(path, file);
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("policy_document_versions")
        .insert({
          policy_document_id: policyDocumentId,
          organization_id: organizationId,
          version_number: versionNumber,
          storage_bucket: "policy-documents",
          storage_path: path,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          content_hash: contentHash,
          created_by: createdBy,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["policy_documents", "versions", data.policy_document_id] });
      queryClient.invalidateQueries({ queryKey: ["policy_documents"] });
    },
  });
}

// Publishing is just: mark this version 'published' (locks it immutable via DB trigger) and
// point the parent document's current_version_id at it. Two calls, not one RPC -- mirrors how
// CourseDetail.tsx publishes a course_version, and keeps each write's own RLS check (version
// update vs. document update) independently enforced rather than bundled behind a single
// security-definer function.
export function usePublishPolicyDocumentVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, policyDocumentId }: { id: string; policyDocumentId: string }) => {
      const { error: versionError } = await supabase
        .from("policy_document_versions")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", id);
      if (versionError) throw versionError;

      const { error: docError } = await supabase
        .from("policy_documents")
        .update({ current_version_id: id })
        .eq("id", policyDocumentId);
      if (docError) throw docError;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["policy_documents", "versions", variables.policyDocumentId] });
      queryClient.invalidateQueries({ queryKey: ["policy_documents"] });
    },
  });
}

export function usePolicyDocumentSignedUrl() {
  return useMutation({
    mutationFn: async (version: PolicyDocumentVersion) => {
      const { data, error } = await supabase.storage.from(version.storage_bucket).createSignedUrl(version.storage_path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
