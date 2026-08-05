import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";
import { completionResponseForServiceOutcome } from "@/lib/serviceDeliveryContract";

export type ResidentServiceRequirement = Tables<"resident_service_requirements">;
export type ServiceTaskAlert = Tables<"service_task_alerts">;
export type ServiceExceptionRule = Tables<"service_exception_rules">;

export interface ResidentServiceTaskQueueRow {
  id: string;
  organization_id: string;
  facility_id: string;
  facility_name: string;
  resident_id: string;
  resident_name: string;
  resident_room: string | null;
  requirement_id: string;
  source_assessment_form_id: string;
  source_plan_version: number;
  service_name: string;
  special_instructions: string;
  responsible_role: string;
  unit_name: string | null;
  requires_two_staff: boolean;
  documentation_mode: string;
  scheduled_start: string;
  scheduled_end: string;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  status: string;
  note: string | null;
  supervisor_notified: boolean;
}

export interface ServiceRequirementWithRelations extends ResidentServiceRequirement {
  resident: { id: string; first_name: string; last_name: string; room: string | null } | null;
  facility: { id: string; name: string } | null;
  unit: { id: string; name: string } | null;
}

export interface ServiceTaskAlertWithRelations extends ServiceTaskAlert {
  resident: { id: string; first_name: string; last_name: string; room: string | null } | null;
  task: { id: string; service_name: string; scheduled_start: string; status: string } | null;
}

export interface ServiceTaskQueueFilters {
  from: string;
  through: string;
  facilityId?: string;
  status?: string;
}

function invalidateServiceTasks(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["resident-service-tasks"] });
  queryClient.invalidateQueries({ queryKey: ["resident-service-requirements"] });
  queryClient.invalidateQueries({ queryKey: ["service-task-alerts"] });
  // The manager and Floor surfaces now write the same structured response. Both therefore refresh
  // the resident-level exception and change detectors that consume completion_response.
  queryClient.invalidateQueries({ queryKey: ["resident-360"] });
  queryClient.invalidateQueries({ queryKey: ["resident-service-exceptions"] });
}

export function useResidentServiceTaskQueue(filters: ServiceTaskQueueFilters) {
  return useQuery({
    queryKey: ["resident-service-tasks", filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_resident_service_task_queue" as never, {
        p_from: filters.from,
        p_through: filters.through,
        p_facility_id: filters.facilityId ?? null,
        p_status: filters.status ?? null,
      } as never);
      if (error) throw error;
      return data as unknown as ResidentServiceTaskQueueRow[];
    },
  });
}

export function useListResidentServiceRequirements(filters: {
  organizationId?: string;
  facilityId?: string;
  residentId?: string;
  status?: string;
} = {}) {
  return useQuery({
    queryKey: ["resident-service-requirements", filters],
    queryFn: async () => {
      let query = supabase
        .from("resident_service_requirements")
        .select(`
          *,
          resident:residents(id, first_name, last_name, room),
          facility:facilities(id, name),
          unit:facility_units(id, name)
        `)
        .order("service_name");
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.residentId) query = query.eq("resident_id", filters.residentId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ServiceRequirementWithRelations[];
    },
  });
}

export function useListServiceTaskAlerts(filters: {
  organizationId?: string;
  facilityId?: string;
  status?: string;
} = {}) {
  return useQuery({
    queryKey: ["service-task-alerts", filters],
    queryFn: async () => {
      let query = supabase
        .from("service_task_alerts")
        .select(`
          *,
          resident:residents(id, first_name, last_name, room),
          task:resident_service_task_instances(id, service_name, scheduled_start, status)
        `)
        .order("created_at", { ascending: false });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ServiceTaskAlertWithRelations[];
    },
  });
}

export function useListServiceExceptionRules(facilityId?: string) {
  return useQuery({
    queryKey: ["service-exception-rules", facilityId],
    queryFn: async () => {
      let query = supabase.from("service_exception_rules").select("*").order("exception_status");
      if (facilityId) query = query.eq("facility_id", facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Backward-compatible manager mutation. The caller still supplies the existing manager-page status,
 * but this hook translates it into the governed completion-response vocabulary and calls the same
 * RPC as Floor. That removes the split where manager-entered refusals and exceptions never reached
 * Resident 360 Needs Attention or change detection.
 */
export function useRecordResidentServiceTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      status,
      note,
      supervisorNotified,
      secondEmployeeId,
    }: {
      taskId: string;
      status: string;
      note?: string;
      supervisorNotified: boolean;
      secondEmployeeId?: string | null;
    }) => {
      const response = completionResponseForServiceOutcome(status);
      const exceptionDetails: Json = {
        note: note?.trim() || null,
        supervisor_notified: supervisorNotified,
        legacy_status: status,
        completed_by_other: status === "completed_by_other",
      };
      const { data, error } = await supabase.rpc("record_service_task_response" as never, {
        p_task_id: taskId,
        p_response: response,
        p_exception_details: exceptionDetails,
        p_second_employee_id: secondEmployeeId ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateServiceTasks(queryClient),
  });
}

/**
 * Raise a supervisor-review work item against a service exception (BACKLOG.md G10).
 *
 * `record_service_exception_follow_up` was reachable by nothing -- no client, no edge function, no
 * other SQL.
 *
 * What it adds is narrower than "no route to a supervisor", and the difference matters.
 * `record_service_task_response` already sets `supervisor_notified` from a checkbox the person
 * documenting ticks, which is a *self-report*: it records that somebody says they told a supervisor.
 * This function is the only thing that creates the `service-exception:<id>` work item -- a tracked
 * row in the shared queue, with a due date, that somebody has to close. So an exception could be
 * marked "supervisor notified" and still have no item anywhere asking anyone to do something about
 * it, and an exception where the box was left unticked had nothing at all.
 *
 * The exception statuses it accepts are `resident_refused`, `resident_unavailable`, `not_completed`
 * and `completed_late`; it refuses anything else with 22023. It is idempotent on the deduplication
 * key, so raising it twice updates the existing item rather than making a second.
 */
export function useRecordServiceExceptionFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, reason }: { taskId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("record_service_exception_follow_up" as never, {
        p_task_instance_id: taskId,
        // The server does `coalesce(p_reason, v.note, <fallback>)`, and an empty string is not null
        // -- sending "" would title the work item with nothing instead of falling back to the note
        // the staff member recorded at the time.
        p_reason: reason.trim() || null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidateServiceTasks(queryClient);
      // The follow-up lands in the shared work queue, not in this page's own lists.
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["daily-operations-command-center"] });
    },
  });
}

export function useAssignResidentServiceTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, employeeId }: { taskId: string; employeeId: string }) => {
      const { data, error } = await supabase.rpc("assign_resident_service_task" as never, {
        p_task_id: taskId,
        p_employee_id: employeeId,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateServiceTasks(queryClient),
  });
}

export function useServiceTaskAvailableStaff(taskId?: string) {
  return useQuery({
    queryKey: ["resident-service-tasks", "available-staff", taskId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_service_task_available_staff" as never, {
        p_task_id: taskId,
      } as never);
      if (error) throw error;
      return data as unknown as { employee_id: string; employee_name: string }[];
    },
    enabled: !!taskId,
  });
}

export function useUpdateResidentServiceRequirement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requirementId,
      frequency,
      frequencyDetail,
      timeWindowStart,
      timeWindowEnd,
      responsibleRole,
      unitId,
      specialInstructions,
      requiresTwoStaff,
      documentationMode,
      expiresOn,
    }: {
      requirementId: string;
      frequency: string;
      frequencyDetail?: string | null;
      timeWindowStart: string;
      timeWindowEnd: string;
      responsibleRole: string;
      unitId?: string | null;
      specialInstructions: string;
      requiresTwoStaff: boolean;
      documentationMode: string;
      expiresOn?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("update_resident_service_requirement" as never, {
        p_requirement_id: requirementId,
        p_frequency: frequency,
        p_frequency_detail: frequencyDetail ?? null,
        p_time_window_start: timeWindowStart,
        p_time_window_end: timeWindowEnd,
        p_responsible_role: responsibleRole,
        p_unit_id: unitId ?? null,
        p_special_instructions: specialInstructions,
        p_requires_two_staff: requiresTwoStaff,
        p_documentation_mode: documentationMode,
        p_expires_on: expiresOn ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateServiceTasks(queryClient),
  });
}

export function useResolveServiceTaskAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ alertId, status }: { alertId: string; status: string }) => {
      const { data, error } = await supabase.rpc("resolve_service_task_alert" as never, {
        p_alert_id: alertId,
        p_status: status,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["service-task-alerts"] }),
  });
}

export function useUpsertServiceExceptionRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      facilityId,
      exceptionStatus,
      thresholdCount,
      lookbackDays,
      actionTarget,
      isActive,
    }: {
      facilityId: string;
      exceptionStatus: string;
      thresholdCount: number;
      lookbackDays: number;
      actionTarget: string;
      isActive: boolean;
    }) => {
      const { data, error } = await supabase.rpc("upsert_service_exception_rule" as never, {
        p_facility_id: facilityId,
        p_exception_status: exceptionStatus,
        p_threshold_count: thresholdCount,
        p_lookback_days: lookbackDays,
        p_action_target: actionTarget,
        p_is_active: isActive,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["service-exception-rules"] }),
  });
}
