import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SurveyEvidencePacketItem {
  id: string;
  organization_id: string;
  facility_id: string | null;
  survey_day_session_id: string | null;
  binder_export_job_id: string | null;
  source_type: string;
  source_id: string | null;
  label: string;
  notes: string | null;
  sort_order: number;
  citation_ref: string | null;
  created_at: string;
}

function rpc() {
  return supabase as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
}

export function useSurveyEvidencePacketItems(args: {
  surveyDaySessionId?: string | null;
  binderExportJobId?: string | null;
}) {
  return useQuery({
    queryKey: ["survey-evidence-packet-items", args],
    queryFn: async () => {
      const { data, error } = await rpc().rpc("list_survey_evidence_packet_items", {
        p_survey_day_session_id: args.surveyDaySessionId ?? null,
        p_binder_export_job_id: args.binderExportJobId ?? null,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as SurveyEvidencePacketItem[];
    },
    staleTime: 10_000,
  });
}

export function useAddSurveyEvidencePacketItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourceType: string;
      label: string;
      sourceId?: string | null;
      facilityId?: string | null;
      surveyDaySessionId?: string | null;
      binderExportJobId?: string | null;
      notes?: string | null;
      citationRef?: string | null;
    }) => {
      const { data, error } = await rpc().rpc("add_survey_evidence_packet_item", {
        p_source_type: input.sourceType,
        p_label: input.label,
        p_source_id: input.sourceId ?? null,
        p_facility_id: input.facilityId ?? null,
        p_survey_day_session_id: input.surveyDaySessionId ?? null,
        p_binder_export_job_id: input.binderExportJobId ?? null,
        p_notes: input.notes ?? null,
        p_sort_order: 0,
        p_citation_ref: input.citationRef ?? null,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["survey-evidence-packet-items"] }),
  });
}

export function useRemoveSurveyEvidencePacketItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await rpc().rpc("remove_survey_evidence_packet_item", { p_item_id: itemId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["survey-evidence-packet-items"] }),
  });
}

export function useAssembleSurveyEvidencePacket() {
  return useMutation({
    mutationFn: async (input: {
      surveyDaySessionId?: string | null;
      binderExportJobId?: string | null;
    }) => {
      const { data, error } = await rpc().rpc("assemble_survey_evidence_packet_manifest", {
        p_survey_day_session_id: input.surveyDaySessionId ?? null,
        p_binder_export_job_id: input.binderExportJobId ?? null,
      });
      if (error) throw new Error(error.message);
      return data as Record<string, unknown>;
    },
  });
}

export interface SurveyEvidencePacketExport {
  id: string;
  organization_id: string;
  facility_id: string | null;
  survey_day_session_id: string | null;
  binder_export_job_id: string | null;
  storage_bucket: string;
  storage_path: string;
  content_sha256: string;
  byte_size: number;
  item_count: number;
  manifest: Record<string, unknown>;
  status: string;
  created_at: string;
}

export function useSurveyEvidencePacketExports(args: {
  surveyDaySessionId?: string | null;
  binderExportJobId?: string | null;
}) {
  return useQuery({
    queryKey: ["survey-evidence-packet-exports", args],
    queryFn: async () => {
      const { data, error } = await rpc().rpc("list_survey_evidence_packet_exports", {
        p_survey_day_session_id: args.surveyDaySessionId ?? null,
        p_binder_export_job_id: args.binderExportJobId ?? null,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as SurveyEvidencePacketExport[];
    },
    staleTime: 10_000,
  });
}

export function usePackageSurveyEvidencePacket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      surveyDaySessionId?: string | null;
      binderExportJobId?: string | null;
      facilityId?: string | null;
    }) => {
      const { data, error } = await supabase.functions.invoke("package-survey-evidence-packet", {
        body: {
          survey_day_session_id: input.surveyDaySessionId ?? null,
          binder_export_job_id: input.binderExportJobId ?? null,
          facility_id: input.facilityId ?? null,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      return data as {
        exportId: string;
        downloadUrl: string | null;
        contentSha256: string;
        byteSize: number;
        itemCount: number;
      };
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["survey-evidence-packet-exports"] });
    },
  });
}

/**
 * Who currently holds guest access to a packet, and taking it back (BACKLOG.md G9).
 *
 * `issue_survey_packet_guest_grant` was wired; `revoke_survey_packet_guest_grant` was called by
 * nothing, and no surface listed existing grants. So a survey evidence packet -- compliance evidence
 * assembled for an external surveyor -- could be shared with a guest, and afterwards nobody could
 * see who held access or take it back. The same product already does this correctly for move-in
 * guests, where both `issue_move_in_guest_grant` and `revoke_move_in_guest_grant` are wired.
 *
 * The read needs no new policy: `survey_packet_guest_grants_select` already admits org_admin,
 * facility_manager and auditor within the organization.
 */
export function useSurveyPacketGuestGrants(packetExportId: string | undefined) {
  return useQuery({
    queryKey: ["survey-packet-guest-grants", packetExportId],
    enabled: Boolean(packetExportId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("survey_packet_guest_grants")
        .select("id, guest_label, expires_at, revoked_at, revocation_reason, download_count, last_downloaded_at, created_at")
        .eq("packet_export_id", packetExportId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as {
        id: string;
        guest_label: string;
        expires_at: string;
        revoked_at: string | null;
        revocation_reason: string | null;
        download_count: number | null;
        last_downloaded_at: string | null;
        created_at: string;
      }[];
    },
  });
}

export function useRevokeSurveyPacketGuestGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; reason: string }) => {
      const { data, error } = await rpc().rpc("revoke_survey_packet_guest_grant", {
        p_grant_id: input.grantId,
        p_reason: input.reason,
      });
      if (error) throw new Error(error.message);
      // The RPC returns false rather than raising when the grant is not found -- a row deleted, or
      // one this caller cannot see. Resolving successfully on that would tell somebody access was
      // withdrawn when nothing was withdrawn, which is the worst possible lie for this particular
      // button.
      if (data !== true) {
        throw new Error("That guest grant no longer exists, so nothing was revoked. Refresh the list.");
      }
      return true;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["survey-packet-guest-grants"] });
      void client.invalidateQueries({ queryKey: ["survey-evidence-packet-exports"] });
    },
  });
}

export function useIssueSurveyPacketGuestGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      packetExportId: string;
      guestLabel: string;
      expiresAt: string;
    }) => {
      const { data, error } = await rpc().rpc("issue_survey_packet_guest_grant", {
        p_packet_export_id: input.packetExportId,
        p_guest_label: input.guestLabel,
        p_expires_at: input.expiresAt,
      });
      if (error) throw new Error(error.message);
      return data as { grantId: string; token: string; expiresAt: string; packetExportId: string };
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["survey-evidence-packet-exports"] });
      // The grant list is the answer to "who can currently see this packet", and issuing is the
      // event that changes it most. Revoke refreshed it and issue did not, so a packet shared with
      // a surveyor did not appear in the list of people holding access to it.
      void client.invalidateQueries({ queryKey: ["survey-packet-guest-grants"] });
    },
  });
}
