import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface MyShiftWorkspace {
  employee: { id: string; name: string; status: string } | null;
  currentOrNextShift: Record<string, any> | null;
  handoffItems: Record<string, any>[];
  residentServiceTasks: Record<string, any>[];
  workItems: Record<string, any>[];
  notifications: Record<string, any>[];
  openShiftOffers: Record<string, any>[];
  timeOffRequests: Record<string, any>[];
  upcomingShifts: Record<string, any>[];
}

export interface DailyOperationsCommandCenter {
  generatedAt: string;
  facilityId: string | null;
  dailyExecution: Record<string, number>;
  morningHuddle: Record<string, any>[];
  [key: string]: any;
}

function asRpc() {
  return supabase as any;
}

export function useMyShiftWorkspace() {
  return useQuery({
    queryKey: ["my-shift-workspace"],
    queryFn: async (): Promise<MyShiftWorkspace> => {
      const { data, error } = await asRpc().rpc("get_my_shift_workspace");
      if (error) throw error;
      return data as MyShiftWorkspace;
    },
    staleTime: 30_000,
  });
}

export function useDailyOperationsCommandCenter(facilityId?: string) {
  return useQuery({
    queryKey: ["daily-operations-command-center", facilityId ?? "portfolio"],
    queryFn: async (): Promise<DailyOperationsCommandCenter> => {
      const { data, error } = await asRpc().rpc("get_daily_operations_command_center", { p_facility_id: facilityId ?? null });
      if (error) throw error;
      return data as DailyOperationsCommandCenter;
    },
    staleTime: 30_000,
  });
}

export function useAcknowledgeShiftReportEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await asRpc().rpc("acknowledge_shift_report_entry", { p_entry_id: entryId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] }),
  });
}

export function useRecordShiftCallOff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ shiftAssignmentId, category, reason }: { shiftAssignmentId: string; category: string; reason: string }) => {
      const { data, error } = await asRpc().rpc("record_shift_call_off", {
        p_shift_assignment_id: shiftAssignmentId,
        p_category: category,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
    },
  });
}

export function useSubmitTimeOffRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { employeeId: string; facilityId: string; startsAt: string; endsAt: string; reason: string }) => {
      const { data, error } = await asRpc().rpc("submit_time_off_request", {
        p_employee_id: input.employeeId,
        p_facility_id: input.facilityId,
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
        p_reason: input.reason,
        p_idempotency_key: `time-off:${input.employeeId}:${input.startsAt}:${input.endsAt}`,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] }),
  });
}

export function useCreateShiftReportEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { facilityId: string; unitId?: string | null; shiftAssignmentId?: string | null; category: string; priority: string; periodStart: string; periodEnd: string; narrative: string; requiresAcknowledgement?: boolean }) => {
      const { data, error } = await asRpc().rpc("create_shift_report_entry", {
        p_facility_id: input.facilityId,
        p_unit_id: input.unitId ?? null,
        p_shift_assignment_id: input.shiftAssignmentId ?? null,
        p_resident_id: null,
        p_category: input.category,
        p_priority: input.priority,
        p_shift_period_start: input.periodStart,
        p_shift_period_end: input.periodEnd,
        p_narrative: input.narrative,
        p_follow_up_owner_profile_id: null,
        p_requires_acknowledgement: input.requiresAcknowledgement ?? true,
        p_idempotency_key: `shift-log:${input.shiftAssignmentId ?? input.facilityId}:${input.category}:${Date.now()}`,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] }),
  });
}
