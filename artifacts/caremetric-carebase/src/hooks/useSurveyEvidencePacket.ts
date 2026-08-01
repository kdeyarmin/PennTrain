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
    },
  });
}
