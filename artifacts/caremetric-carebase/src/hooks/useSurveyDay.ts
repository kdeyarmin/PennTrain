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
  exclusionState: ReadinessState;
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
    },
  });
}

export function useSetSurveyDayDisposition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; itemId: string; disposition: SurveyDayDisposition | null; note: string }) => {
      const { data, error } = await supabase.rpc("set_survey_day_checklist_disposition", {
        p_session_id: input.sessionId,
        p_item_id: input.itemId,
        p_disposition: input.disposition as string,
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
