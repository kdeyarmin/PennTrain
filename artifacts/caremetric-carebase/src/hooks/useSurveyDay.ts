import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ReadinessState = "ready" | "attention" | "unknown";
export type SurveyDayDisposition = "ready" | "provided" | "not_requested" | "needs_follow_up";

export interface SurveyDaySessionSummary {
  id: string;
  facilityId: string;
  status: string;
  activatedBy: string;
  activatedByName: string | null;
  activatedAt: string;
  lastRefreshedAt: string;
}

export interface SurveyDayChecklistItem {
  id: string;
  entranceConferenceItemId: string | null;
  prompt: string;
  category: string;
  dataSource: string;
  itemTypes: string[] | null;
  sortOrder: number;
  disposition: SurveyDayDisposition | null;
  dispositionNote: string | null;
  dispositionAt: string | null;
}

export interface SurveyDayWorkspace {
  session: {
    id: string;
    organizationId: string;
    facilityId: string;
    status: string;
    activatedBy: string;
    activatedByName: string | null;
    activatedAt: string;
    lastRefreshedAt: string;
    pinnedBinderJobId: string | null;
    pinnedEvidenceCollectionId: string | null;
    closedAt: string | null;
    closeReason: string | null;
  };
  checklist: SurveyDayChecklistItem[];
}

export interface SurveyDayRosterRow {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  trainingState: ReadinessState;
  credentialState: ReadinessState;
  backgroundState: ReadinessState;
  overallFlag: "ready" | "attention";
  route: string;
}

export interface SurveyDayRoster {
  rows: SurveyDayRosterRow[];
  count: number;
  summary: { total: number; ready: number; attention: number };
  page: number;
  pageSize: number;
}

export function useActiveSurveyDaySession(facilityId: string | undefined) {
  return useQuery({
    queryKey: ["survey-day-active", facilityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_active_survey_day_session", { p_facility_id: facilityId! });
      if (error) throw error;
      return (data as unknown as SurveyDaySessionSummary | null) ?? null;
    },
    enabled: Boolean(facilityId),
  });
}

export function useSurveyDayWorkspace(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["survey-day-workspace", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_survey_day_workspace", { p_session_id: sessionId! });
      if (error) throw error;
      return data as unknown as SurveyDayWorkspace;
    },
    enabled: Boolean(sessionId),
  });
}

export function useSurveyDayStaffRoster(sessionId: string | undefined, search: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: ["survey-day-roster", sessionId, search, page, pageSize],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_survey_day_staff_roster", {
        p_session_id: sessionId!,
        p_search: search || undefined,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as unknown as SurveyDayRoster;
    },
    enabled: Boolean(sessionId),
    placeholderData: (previous) => previous,
  });
}

export function useActivateSurveyDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (facilityId: string) => {
      const { data, error } = await supabase.rpc("activate_survey_day", { p_facility_id: facilityId });
      if (error) throw error;
      return data as unknown as { id: string; facility_id: string; status: string };
    },
    onSuccess: (_data, facilityId) => queryClient.invalidateQueries({ queryKey: ["survey-day-active", facilityId] }),
  });
}

export function useRefreshSurveyDay(facilityId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc("refresh_survey_day", { p_session_id: sessionId });
      if (error) throw error;
      return data as unknown as { sessionId: string; lastRefreshedAt: string; throttled: boolean };
    },
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ["survey-day-workspace", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["survey-day-active", facilityId] });
      // "Refresh live checks" must actually refresh the live data: the staff roster RPC
      // plus the four sources the entrance-conference chips derive from. Without these,
      // a gap fixed mid-survey stays "Attention" until the 60s staleTime lapses.
      queryClient.invalidateQueries({ queryKey: ["survey-day-roster"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["training_records"] });
      queryClient.invalidateQueries({ queryKey: ["employee_credentials"] });
      queryClient.invalidateQueries({ queryKey: ["inspection_items"] });
    },
  });
}

export function useSetSurveyDayDisposition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; itemId: string; disposition: SurveyDayDisposition; note: string }) => {
      const { data, error } = await supabase.rpc("set_survey_day_checklist_disposition", {
        p_session_id: input.sessionId,
        p_item_id: input.itemId,
        p_disposition: input.disposition,
        p_note: input.note,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: ["survey-day-workspace", input.sessionId] }),
  });
}

export function usePinSurveyDayBinder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; binderJobId: string }) => {
      const { data, error } = await supabase.rpc("pin_survey_day_binder", { p_session_id: input.sessionId, p_binder_job_id: input.binderJobId });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: ["survey-day-workspace", input.sessionId] }),
  });
}

// ---------------------------------------------------------------------------------------------
// The live log: who is here, what they asked for, what was seen and said (Phase 10a, item 23).
//
// The packet is a read, not a stored artefact, so every write below invalidates the same key and
// the packet re-reads. There is deliberately no client-side cache of an "assembled" packet: a
// frozen copy would be a second version of the truth that drifts from the record it summarises.
// ---------------------------------------------------------------------------------------------

export type SurveyDayEntryType = "interview" | "observation" | "potential_finding";
export type SurveyDayRequestStatus = "open" | "provided" | "unavailable" | "withdrawn";
export type SurveyDayFindingDisposition = "potential" | "accepted" | "disputed" | "resolved_on_site";

export interface SurveyDayPacket {
  sessionId: string;
  facilityId: string;
  status: string;
  activatedAt: string;
  closedAt: string | null;
  surveyors: {
    id: string;
    name: string;
    title: string | null;
    agency: string | null;
    isLead: boolean;
    arrivedAt: string;
    departedAt: string | null;
  }[];
  requests: {
    id: string;
    requestedAt: string;
    request: string;
    dueAt: string | null;
    status: SurveyDayRequestStatus;
    providedAt: string | null;
    providedNote: string | null;
    assignedTo: string | null;
  }[];
  openRequests: number;
  overdueRequests: number;
  interviews: { id: string; occurredAt: string; summary: string; subjectRole: string | null }[];
  observations: { id: string; occurredAt: string; summary: string; subjectRole: string | null }[];
  potentialFindings: {
    id: string;
    occurredAt: string;
    summary: string;
    citation: string | null;
    disposition: SurveyDayFindingDisposition | null;
    basis: string | null;
    followUpWorkItemId: string | null;
  }[];
  pinnedBinderJobId: string | null;
  pinnedEvidenceCollectionId: string | null;
  assembledAt: string;
}

export function useSurveyDayPacket(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["survey-day-packet", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_survey_day_packet", { p_session_id: sessionId! });
      if (error) throw error;
      return data as unknown as SurveyDayPacket;
    },
    enabled: Boolean(sessionId),
  });
}

function useSurveyDayLogMutation<TInput extends { sessionId: string }, TResult>(
  run: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["survey-day-packet", input.sessionId] });
    },
  });
}

export function useRecordSurveyDaySurveyor() {
  return useSurveyDayLogMutation(async (input: {
    sessionId: string; name: string; title?: string; agency?: string; isLead?: boolean;
  }) => {
    const { data, error } = await supabase.rpc("record_survey_day_surveyor", {
      p_session_id: input.sessionId,
      p_surveyor_name: input.name,
      p_title: input.title || undefined,
      p_agency: input.agency || undefined,
      p_is_lead: input.isLead ?? false,
    });
    if (error) throw error;
    return data as string;
  });
}

export function useRecordSurveyDayRequest() {
  return useSurveyDayLogMutation(async (input: {
    sessionId: string; requestText: string; surveyorId?: string; assignedTo?: string; dueAt?: string;
  }) => {
    const { data, error } = await supabase.rpc("record_survey_day_request", {
      p_session_id: input.sessionId,
      p_request_text: input.requestText,
      p_surveyor_id: input.surveyorId || undefined,
      p_assigned_to: input.assignedTo || undefined,
      p_due_at: input.dueAt || undefined,
    });
    if (error) throw error;
    return data as string;
  });
}

export function useResolveSurveyDayRequest() {
  return useSurveyDayLogMutation(async (input: {
    sessionId: string; requestId: string; status: Exclude<SurveyDayRequestStatus, "open">; note: string;
  }) => {
    const { data, error } = await supabase.rpc("resolve_survey_day_request", {
      p_request_id: input.requestId,
      p_status: input.status,
      p_provided_note: input.note,
    });
    if (error) throw error;
    return data as boolean;
  });
}

export function useRecordSurveyDayObservation() {
  return useSurveyDayLogMutation(async (input: {
    sessionId: string;
    entryType: SurveyDayEntryType;
    summary: string;
    subjectRole?: string;
    citation?: string;
    findingDisposition?: SurveyDayFindingDisposition;
    findingBasis?: string;
  }) => {
    const { data, error } = await supabase.rpc("record_survey_day_observation", {
      p_session_id: input.sessionId,
      p_entry_type: input.entryType,
      p_summary: input.summary,
      p_subject_role: input.subjectRole || undefined,
      p_citation: input.citation || undefined,
      p_finding_disposition: input.findingDisposition || undefined,
      p_finding_basis: input.findingBasis || undefined,
    });
    if (error) throw error;
    return data as string;
  });
}

export function useRecordSurveyDayPacketAssembled() {
  return useSurveyDayLogMutation(async (input: { sessionId: string }) => {
    const { data, error } = await supabase.rpc("record_survey_day_packet_assembled", {
      p_session_id: input.sessionId,
    });
    if (error) throw error;
    return data as boolean;
  });
}

export function useCloseSurveyDay(facilityId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("close_survey_day", { p_session_id: input.sessionId, p_reason: input.reason });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["survey-day-workspace", input.sessionId] });
      queryClient.invalidateQueries({ queryKey: ["survey-day-active", facilityId] });
    },
  });
}
