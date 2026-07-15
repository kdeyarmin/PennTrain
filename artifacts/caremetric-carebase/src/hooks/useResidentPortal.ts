import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type ResidentPortalGrant = Tables<"resident_portal_grants">;
export type ResidentPortalMessage = Tables<"resident_portal_messages">;
export type ResidentPortalSharedDocument = Tables<"resident_portal_shared_documents">;
export type ResidentDocument = Tables<"resident_documents">;

export interface ResidentPortalManagementWorkspace {
  grants: ResidentPortalGrant[];
  messages: ResidentPortalMessage[];
  sharedDocuments: ResidentPortalSharedDocument[];
  residentDocuments: ResidentDocument[];
}

export interface ResidentPortalSnapshot {
  accessStatus: "invalid" | "terms_required" | "active";
  termsVersion?: string;
  expiresAt?: string;
  designatedPersonName?: string;
  relationship?: string;
  permissions?: string[];
  resident?: { displayName: string; room: string | null };
  facility?: { name: string; phone: string | null; address: string };
  schedule?: Array<{
    id: string;
    eventType: string;
    title: string;
    startsAt: string;
    endsAt: string;
    locationName: string | null;
    transportationMode: string;
    preparationInstructions: string | null;
  }>;
  finance?: {
    statementNumber: string;
    issuedOn: string;
    dueDate: string;
    balanceDue: number;
    delinquentAmount: number;
  } | null;
  documents?: Array<{
    id: string;
    displayLabel: string;
    fileName: string;
    fileType: string;
    sharedAt: string;
  }>;
  messages?: Array<{
    id: string;
    direction: "designated_person_to_facility" | "facility_to_designated_person";
    body: string;
    createdAt: string;
  }>;
}

export function useResidentPortalManagement(residentId?: string) {
  return useQuery({
    queryKey: ["resident-portal-management", residentId],
    enabled: Boolean(residentId),
    queryFn: async (): Promise<ResidentPortalManagementWorkspace> => {
      const [grants, messages, sharedDocuments, residentDocuments] = await Promise.all([
        supabase.from("resident_portal_grants").select("*").eq("resident_id", residentId!).order("created_at", { ascending: false }),
        supabase.from("resident_portal_messages").select("*").eq("resident_id", residentId!).order("created_at", { ascending: false }).limit(100),
        supabase.from("resident_portal_shared_documents").select("*").eq("resident_id", residentId!).order("shared_at", { ascending: false }),
        supabase.from("resident_documents").select("*").eq("resident_id", residentId!).order("created_at", { ascending: false }),
      ]);
      const failed = [grants, messages, sharedDocuments, residentDocuments].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        grants: grants.data ?? [],
        messages: messages.data ?? [],
        sharedDocuments: sharedDocuments.data ?? [],
        residentDocuments: residentDocuments.data ?? [],
      };
    },
  });
}

export function useCreateResidentPortalGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      designatedPersonName: string;
      relationshipLabel: string;
      contactEmail?: string;
      permissions: string[];
      expiresAt: string;
    }) => {
      const { data, error } = await supabase.rpc("create_resident_portal_grant", {
        p_resident_id: input.residentId,
        p_designated_person_name: input.designatedPersonName,
        p_relationship_label: input.relationshipLabel,
        p_contact_email: input.contactEmail ?? "",
        p_permissions: input.permissions,
        p_expires_at: input.expiresAt,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result) throw new Error("The portal grant was not returned.");
      return result;
    },
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: ["resident-portal-management", input.residentId] }),
  });
}

export function useRevokeResidentPortalGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; residentId: string; reason: string }) => {
      const { error } = await supabase.rpc("revoke_resident_portal_grant", { p_grant_id: input.grantId, p_reason: input.reason });
      if (error) throw error;
    },
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: ["resident-portal-management", input.residentId] }),
  });
}

export function useShareResidentPortalDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; residentId: string; documentId: string; displayLabel: string; share: boolean }) => {
      const { error } = await supabase.rpc("share_resident_portal_document", {
        p_grant_id: input.grantId,
        p_document_id: input.documentId,
        p_display_label: input.displayLabel,
        p_share: input.share,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: ["resident-portal-management", input.residentId] }),
  });
}

export function useReplyResidentPortalMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; residentId: string; body: string }) => {
      const { data, error } = await supabase.rpc("reply_resident_portal_message", { p_grant_id: input.grantId, p_body: input.body });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: ["resident-portal-management", input.residentId] }),
  });
}

function asSnapshot(value: Json): ResidentPortalSnapshot {
  return value as unknown as ResidentPortalSnapshot;
}

export async function getResidentPortalSnapshot(token: string, fingerprint?: string): Promise<ResidentPortalSnapshot> {
  const { data, error } = await supabase.rpc("get_resident_portal_snapshot", {
    p_token: token,
    ...(fingerprint ? { p_request_fingerprint_sha256: fingerprint } : {}),
  });
  if (error) throw error;
  return asSnapshot(data);
}

export async function acceptResidentPortalTerms(token: string, termsVersion: string, fingerprint?: string) {
  const { data, error } = await supabase.rpc("accept_resident_portal_terms", {
    p_token: token,
    p_terms_version: termsVersion,
    ...(fingerprint ? { p_request_fingerprint_sha256: fingerprint } : {}),
  });
  if (error) throw error;
  return data;
}

export async function postResidentPortalMessage(token: string, body: string, fingerprint?: string) {
  const { data, error } = await supabase.rpc("post_resident_portal_message", {
    p_token: token,
    p_body: body,
    ...(fingerprint ? { p_request_fingerprint_sha256: fingerprint } : {}),
  });
  if (error) throw error;
  return data;
}
