import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";
import type {
  CorrectiveActionLike, IncidentNotificationLike, IncidentRowLike,
} from "@/lib/incidentStages";

export interface IncidentFollowThroughPayload {
  incident: IncidentRowLike;
  notifications: IncidentNotificationLike[];
  corrective_actions: CorrectiveActionLike[];
  assessment_review_finalized: boolean;
  support_plan_revised_after_incident: boolean;
}

export function useIncidentFollowThrough(incidentId: string | undefined) {
  return useQuery({
    queryKey: ["incident-follow-through", incidentId],
    enabled: Boolean(incidentId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_incident_follow_through" as never, {
        p_incident_id: incidentId,
      } as never);
      if (error) throw error;
      return data as unknown as IncidentFollowThroughPayload | null;
    },
  });
}

/**
 * Every write invalidates both this query and the incident/notification queries the rest of the page
 * reads, because a single call routinely changes all three -- determining reportability, for
 * instance, also creates or stands down notification rows.
 */
function useIncidentWrite<TInput>(
  incidentId: string | undefined,
  run: (input: TInput) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incident-follow-through", incidentId] });
      queryClient.invalidateQueries({ queryKey: ["incident_notifications", incidentId] });
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
    },
  });
}

async function callRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data;
}

export function useSaveIncidentPathway(incidentId: string | undefined) {
  return useIncidentWrite<{ pathwayKey: string; answers: Json; complete: boolean }>(
    incidentId,
    (input) => callRpc("save_incident_pathway", {
      p_incident_id: incidentId,
      p_pathway_key: input.pathwayKey,
      p_answers: input.answers,
      p_complete: input.complete,
    }),
  );
}

export function useDetermineIncidentReportability(incidentId: string | undefined) {
  return useIncidentWrite<{ status: "reportable" | "not_reportable"; rationale: string }>(
    incidentId,
    (input) => callRpc("determine_incident_reportability", {
      p_incident_id: incidentId,
      p_status: input.status,
      p_rationale: input.rationale,
    }),
  );
}

export function useSaveIncidentInvestigationStep(incidentId: string | undefined) {
  return useIncidentWrite<{
    immediateResponse?: string;
    investigationFindings?: string;
    rootCause?: string;
    rootCauseMethod?: string;
  }>(
    incidentId,
    (input) => callRpc("save_incident_investigation_step", {
      p_incident_id: incidentId,
      p_immediate_response: input.immediateResponse ?? null,
      p_investigation_findings: input.investigationFindings ?? null,
      p_root_cause: input.rootCause ?? null,
      p_root_cause_method: input.rootCauseMethod ?? null,
    }),
  );
}

export function useSetIncidentQapiConsideration(incidentId: string | undefined) {
  return useIncidentWrite<{
    consideration: "linked" | "not_indicated";
    qapiProjectId?: string;
    note?: string;
  }>(
    incidentId,
    (input) => callRpc("set_incident_qapi_consideration", {
      p_incident_id: incidentId,
      p_consideration: input.consideration,
      p_qapi_project_id: input.qapiProjectId ?? null,
      p_note: input.note ?? null,
    }),
  );
}

export function useApproveIncidentInvestigation(incidentId: string | undefined) {
  return useIncidentWrite<{ note?: string }>(
    incidentId,
    (input) => callRpc("approve_incident_investigation", {
      p_incident_id: incidentId,
      p_note: input.note ?? null,
    }),
  );
}
