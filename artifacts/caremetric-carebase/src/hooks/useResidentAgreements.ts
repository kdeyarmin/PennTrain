import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ResidentAgreement = Tables<"resident_agreements">;
export type ResidentAgreementVersion = Tables<"resident_agreement_versions">;
export type ResidentAgreementSignature = Tables<"resident_agreement_signatures">;
export type ResidentAgreementGuestGrant = Tables<"resident_agreement_guest_grants">;
export type ResidentAgreementHistory = Tables<"resident_agreement_history">;

export interface ResidentAgreementData {
  agreements: ResidentAgreement[];
  versions: ResidentAgreementVersion[];
  signatures: ResidentAgreementSignature[];
  guestGrants: ResidentAgreementGuestGrant[];
  history: ResidentAgreementHistory[];
}

const invalidate = (client: ReturnType<typeof useQueryClient>, residentId?: string) => {
  client.invalidateQueries({ queryKey: ["resident-agreements", residentId] });
  client.invalidateQueries({ queryKey: ["resident-administrative-master", residentId] });
  client.invalidateQueries({ queryKey: ["residents", residentId] });
  client.invalidateQueries({ queryKey: ["admissions"] });
};

export function useResidentAgreements(residentId?: string) {
  return useQuery({
    queryKey: ["resident-agreements", residentId],
    queryFn: async (): Promise<ResidentAgreementData> => {
      const [agreements, versions, signatures, guestGrants, history] = await Promise.all([
        supabase.from("resident_agreements").select("*").eq("resident_id", residentId!).order("created_at", { ascending: false }),
        supabase.from("resident_agreement_versions").select("*").eq("resident_id", residentId!).order("version_number", { ascending: false }),
        supabase.from("resident_agreement_signatures").select("*").eq("resident_id", residentId!).order("signed_at", { ascending: false }),
        supabase.from("resident_agreement_guest_grants").select("*").eq("resident_id", residentId!).order("created_at", { ascending: false }),
        supabase.from("resident_agreement_history").select("*").eq("resident_id", residentId!).order("occurred_at", { ascending: false }).limit(40),
      ]);
      const error = agreements.error ?? versions.error ?? signatures.error ?? guestGrants.error ?? history.error;
      if (error) throw error;
      return {
        agreements: agreements.data ?? [],
        versions: versions.data ?? [],
        signatures: signatures.data ?? [],
        guestGrants: guestGrants.data ?? [],
        history: history.data ?? [],
      };
    },
    enabled: !!residentId,
  });
}

export function usePublishResidentAgreementVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      agreementId?: string;
      agreementType: string;
      title: string;
      versionLabel: string;
      contentText: string;
      effectiveAt: string;
      requiredSignerRoles: string[];
      documentId?: string;
      amendmentReason?: string;
    }) => {
      const { data, error } = await supabase.rpc("publish_resident_agreement_version", {
        p_resident_id: input.residentId,
        p_agreement_id: input.agreementId,
        p_agreement_type: input.agreementType,
        p_title: input.title,
        p_version_label: input.versionLabel,
        p_content_text: input.contentText,
        p_effective_at: input.effectiveAt,
        p_required_signer_roles: input.requiredSignerRoles,
        p_document_id: input.documentId,
        p_amendment_reason: input.amendmentReason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidate(client, input.residentId),
  });
}

export function useRecordResidentAgreementOutcome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      versionId: string;
      outcome: string;
      signerName: string;
      signerRole: string;
      relationship: string;
      legalAuthority?: string;
      authenticationMethod: string;
      attestation: string;
      reason?: string;
      witnessName?: string;
      witnessRelationship?: string;
      copyDeliveredAt?: string;
      copyDeliveryMethod?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_resident_agreement_outcome", {
        p_version_id: input.versionId,
        p_outcome: input.outcome,
        p_signer_name: input.signerName,
        p_signer_role: input.signerRole,
        p_relationship: input.relationship,
        p_legal_authority: input.legalAuthority ?? "",
        p_authentication_method: input.authenticationMethod,
        p_attestation: input.attestation,
        p_reason: input.reason ?? "",
        p_witness_name: input.witnessName ?? "",
        p_witness_relationship: input.witnessRelationship ?? "",
        p_device_evidence: navigator.userAgent,
        p_copy_delivered_at: input.copyDeliveredAt,
        p_copy_delivery_method: input.copyDeliveryMethod,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidate(client, input.residentId),
  });
}

export function useIssueResidentAgreementGuestGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { residentId: string; guestLabel: string; versionIds: string[]; expiresAt: string; signerRole: string }) => {
      const { data, error } = await supabase.rpc("issue_resident_agreement_guest_grant", {
        p_resident_id: input.residentId,
        p_guest_label: input.guestLabel,
        p_version_ids: input.versionIds,
        p_expires_at: input.expiresAt,
        p_signer_role: input.signerRole,
        p_terms_version: "resident-esign-v1",
      });
      if (error) throw error;
      return data as { grantId: string; token: string; signerRole: string };
    },
    onSuccess: (_data, input) => invalidate(client, input.residentId),
  });
}

export function useRevokeResidentAgreementGuestGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { residentId: string; grantId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("revoke_resident_agreement_guest_grant", {
        p_grant_id: input.grantId,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidate(client, input.residentId),
  });
}

export function useMarkResidentAgreementCopyDelivered() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { residentId: string; signatureId: string; deliveredAt: string; deliveryMethod: string }) => {
      const { data, error } = await supabase.rpc("mark_resident_agreement_copy_delivered", {
        p_signature_id: input.signatureId,
        p_delivered_at: input.deliveredAt,
        p_delivery_method: input.deliveryMethod,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidate(client, input.residentId),
  });
}

export interface ResidentAgreementGuestWorkspace {
  guestLabel: string;
  signerRole: string;
  residentName: string;
  expiresAt: string;
  termsVersion: string;
  agreements: {
    agreementId: string;
    versionId: string;
    agreementType: string;
    title: string;
    versionLabel: string;
    contentText: string;
    contentSha256: string;
    effectiveAt: string;
    requiredSignerRoles: string[];
    signerRole: string;
    documentLabel: string | null;
    responded: boolean;
  }[];
}

export function useResidentAgreementGuestWorkspace(token?: string) {
  return useQuery({
    queryKey: ["resident-agreement-guest", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_resident_agreement_guest_workspace", { p_token: token! });
      if (error) throw error;
      return data as unknown as ResidentAgreementGuestWorkspace;
    },
    enabled: !!token,
    retry: false,
  });
}

export function useAcceptResidentAgreementGuestTerms() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.rpc("accept_resident_agreement_guest_terms", {
        p_token: token,
        p_device_evidence: navigator.userAgent,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["resident-agreement-guest"] }),
  });
}

export function useRespondToResidentAgreementGuest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      token: string;
      versionId: string;
      outcome: string;
      signerName: string;
      signerRole: string;
      relationship: string;
      legalAuthority?: string;
      attestation: string;
      reason?: string;
      witnessName?: string;
      witnessRelationship?: string;
    }) => {
      const { data, error } = await supabase.rpc("respond_to_resident_agreement_guest", {
        p_token: input.token,
        p_version_id: input.versionId,
        p_outcome: input.outcome,
        p_signer_name: input.signerName,
        p_signer_role: input.signerRole,
        p_relationship: input.relationship,
        p_legal_authority: input.legalAuthority ?? "",
        p_attestation: input.attestation,
        p_reason: input.reason ?? "",
        p_witness_name: input.witnessName ?? "",
        p_witness_relationship: input.witnessRelationship ?? "",
        p_device_evidence: navigator.userAgent,
        p_ip_evidence: undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["resident-agreement-guest"] }),
  });
}
