import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type UnscheduledService = Tables<"resident_unscheduled_services">;

function invalidateFloor(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["resident-service-tasks"] });
  queryClient.invalidateQueries({ queryKey: ["unscheduled-services"] });
  queryClient.invalidateQueries({ queryKey: ["resident-360"] });
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

export function useResidentUnscheduledServices(residentId: string | undefined, limit = 25) {
  return useQuery({
    queryKey: ["unscheduled-services", residentId, limit],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_unscheduled_services")
        .select("*")
        .eq("resident_id", residentId!)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as UnscheduledService[];
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
 * Documented exceptions for one resident, newest first. Feeds the conflict detector's
 * `documented_assistance_exceeds_plan` rule, which was wired to an empty array until structured
 * exception documentation existed.
 *
 * Filters server-side on the partial index added with the exception columns: routine completions are
 * excluded, so a resident with a year of clean documentation does not download it all.
 */
export function useResidentServiceExceptions(residentId: string | undefined, limit = 100) {
  return useQuery({
    queryKey: ["resident-service-exceptions", residentId, limit],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_service_task_instances")
        .select("id, service_name, status, completion_response, documented_assistance_level, performed_at, scheduled_start")
        .eq("resident_id", residentId!)
        .not("completion_response", "is", null)
        .neq("completion_response", "completed_as_planned")
        .order("performed_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) throw error;
      return data as {
        id: string;
        service_name: string;
        status: string;
        completion_response: string | null;
        documented_assistance_level: string | null;
        performed_at: string | null;
        scheduled_start: string;
      }[];
    },
  });
}
