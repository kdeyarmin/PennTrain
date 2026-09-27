import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";
import { addFacilityCalendarDays, facilityDayBounds, facilityToday } from "@/lib/dateUtils";
import { DOCUMENTED_ASSISTANCE_WINDOW_DAYS } from "@/lib/residentCareConflicts";
import {
  ASSISTANCE_WINDOW_DAYS, REFUSAL_WINDOW_DAYS, SUPERVISION_WINDOW_DAYS, UNSCHEDULED_WINDOW_DAYS,
} from "@/lib/residentChangeDetection";

export type UnscheduledService = Tables<"resident_unscheduled_services">;

/** Longest window any caller counts. A shorter fetch would drop the oldest rows those rules need. */
const SERVICE_EXCEPTION_WINDOW_DAYS = Math.max(
  ASSISTANCE_WINDOW_DAYS,
  REFUSAL_WINDOW_DAYS,
  DOCUMENTED_ASSISTANCE_WINDOW_DAYS,
);
const UNSCHEDULED_SERVICE_WINDOW_DAYS = Math.max(UNSCHEDULED_WINDOW_DAYS, SUPERVISION_WINDOW_DAYS);
const PAGE = 500;

function invalidateFloor(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["resident-service-tasks"] });
  queryClient.invalidateQueries({ queryKey: ["unscheduled-services"] });
  queryClient.invalidateQueries({ queryKey: ["resident-360"] });
  // Floor exception documentation feeds Resident 360 Needs Attention
  // (increased assistance / repeated refusals) and change-signal detection.
  queryClient.invalidateQueries({ queryKey: ["resident-service-exceptions"] });
  // get_resident_service_utilization counts exactly the rows the floor writes insert.
  queryClient.invalidateQueries({ queryKey: ["resident-service-utilization"] });
}

/**
 * Records a documentation response against a scheduled task. Distinct from
 * `useRecordResidentServiceTask`, which writes only the legacy status -- this carries the structured
 * exception payload the conflict and change detectors read.
 */
export function useRecordServiceTaskResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      response: string;
      exceptionDetails?: Json;
      secondEmployeeId?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_service_task_response" as never, {
        p_task_id: input.taskId,
        p_response: input.response,
        p_exception_details: input.exceptionDetails ?? {},
        p_second_employee_id: input.secondEmployeeId ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFloor(queryClient),
  });
}

export function useRecordUnscheduledService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      serviceKind: string;
      durationMinutes?: number;
      requiresTwoStaff?: boolean;
      note?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_unscheduled_service" as never, {
        p_resident_id: input.residentId,
        p_service_kind: input.serviceKind,
        p_occurred_at: null,
        p_duration_minutes: input.durationMinutes ?? null,
        p_requires_two_staff: input.requiresTwoStaff ?? false,
        p_note: input.note ?? null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateFloor(queryClient),
  });
}

export function useResidentUnscheduledServices(residentId: string | undefined) {
  return useQuery({
    queryKey: ["unscheduled-services", residentId, UNSCHEDULED_SERVICE_WINDOW_DAYS],
    enabled: !!residentId,
    queryFn: async () => {
      // Supervision is a subset of these rows. The newest 50 could be toileting and
      // transfers, and the extra supervision in the same two weeks never reached the count.
      const since = facilityDayBounds(
        addFacilityCalendarDays(facilityToday(), -UNSCHEDULED_SERVICE_WINDOW_DAYS),
      ).from;
      const rows: UnscheduledService[] = [];
      for (let from = 0; ;) {
        const { data, error } = await supabase
          .from("resident_unscheduled_services")
          .select("*")
          .eq("resident_id", residentId!)
          .gte("occurred_at", since)
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
        from += data.length;
      }
      return rows;
    },
  });
}

export function useResidentServiceUtilization(residentId: string | undefined, days = 30) {
  return useQuery({
    queryKey: ["resident-service-utilization", residentId, days],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      }).rpc("get_resident_service_utilization", { p_resident_id: residentId, p_days: days });
      if (error) throw new Error(error.message);
      return data as {
        residentId: string;
        windowDays: number;
        since: string;
        unscheduled: Record<string, number>;
        unscheduledTotal: number;
        exceptions: Record<string, number>;
        documentedAssistance: Record<string, number>;
      };
    },
    staleTime: 60_000,
  });
}

/**
 * Exception documentation inside the detection window, not the newest hundred of all time.
 *
 * Needs attention, change signals, and care conflicts all count these rows over 14 days.
 * A hard limit of 100 kept the newest notes and dropped the rest, so a week of refusals
 * could hide the extra-assistance notes that were supposed to raise their own card.
 */
export function useResidentServiceExceptions(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident-service-exceptions", residentId, SERVICE_EXCEPTION_WINDOW_DAYS],
    enabled: !!residentId,
    queryFn: async () => {
      const since = facilityDayBounds(
        addFacilityCalendarDays(facilityToday(), -SERVICE_EXCEPTION_WINDOW_DAYS),
      ).from;
      const rows: {
        id: string;
        service_name: string;
        status: string;
        completion_response: string | null;
        documented_assistance_level: string | null;
        performed_at: string | null;
        scheduled_start: string;
      }[] = [];
      for (let from = 0; ;) {
        const { data, error } = await supabase
          .from("resident_service_task_instances")
          .select("id, service_name, status, completion_response, documented_assistance_level, performed_at, scheduled_start")
          .eq("resident_id", residentId!)
          .not("completion_response", "is", null)
          .neq("completion_response", "completed_as_planned")
          .gte("performed_at", since)
          .order("performed_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
        from += data.length;
      }
      return rows;
    },
  });
}
