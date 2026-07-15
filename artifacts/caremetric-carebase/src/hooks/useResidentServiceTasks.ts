import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

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
      const { data, error } = await supabase.rpc("record_resident_service_task" as never, {
        p_task_id: taskId,
        p_status: status,
        p_note: note ?? null,
        p_supervisor_notified: supervisorNotified,
        p_second_employee_id: secondEmployeeId ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateServiceTasks(queryClient),
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
