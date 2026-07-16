import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type AutomationAction =
  | { type: "create_work_item"; title: string; description?: string; priority?: "low" | "normal" | "high" | "urgent"; dueDays?: number }
  | { type: "notify_roles"; title: string; body?: string; roles: string[]; link?: string };

export interface ProductValueWorkspace {
  automations: Array<Record<string, any>>;
  automationRuns: Array<Record<string, any>>;
  warRooms: Array<Record<string, any> & { requests: Array<Record<string, any>> }>;
  implementationProjects: Array<Record<string, any> & { tasks: Array<Record<string, any>> }>;
  reportSchedules: Array<Record<string, any>>;
  integration: {
    credentials: Array<Record<string, any>>;
    endpoints: Array<Record<string, any>>;
    deliveryFailures: number;
  };
  portalRequests: Array<Record<string, any>>;
  medicationExceptions: Array<Record<string, any>>;
  copilotDrafts: Array<Record<string, any>>;
  offline: { activeDevices: number; activeManifests: number; syncConflicts: number };
  generatedAt: string;
}

export interface CustomerValueDashboard {
  configured: boolean;
  periodDays: number;
  activity: { reportExports: number; mockInspections: number; courseCompletions: number; closedWorkItems: number; portalMessages: number };
  estimatedHoursSaved: number;
  estimatedLaborValue: number;
  retiredSoftwareMonthlyCost: number;
  retiredTools: string[];
  assumptions: Record<string, number>;
  method: string;
  generatedAt: string;
}

export interface StaffingOptimizationSnapshot {
  facilityId: string;
  from: string;
  through: string;
  scheduleId: string | null;
  workload: Record<string, any>;
  openShifts: number;
  pendingTimeOff: number;
  pendingSwaps: number;
  recentBlockedAssignments: number;
  recommendations: Array<{ priority: string; title: string; href: string }>;
  generatedAt: string;
}

export interface AdmissionsIntelligenceSnapshot {
  pipeline: { active: number; admitted30Days: number; lost30Days: number; expected30Days: number };
  occupancy: { occupiedBeds: number; availableBeds: number; reservedBeds: number };
  referralSources: Array<{ source: string; inquiries: number; admitted: number; conversion_percent: number }>;
  generatedAt: string;
}

function rpc() {
  return supabase as any;
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["product-value-workspace"] });
  queryClient.invalidateQueries({ queryKey: ["customer-value-dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
}

export function useProductValueWorkspace(facilityId?: string) {
  return useQuery({
    queryKey: ["product-value-workspace", facilityId ?? "portfolio"],
    queryFn: async (): Promise<ProductValueWorkspace> => {
      const { data, error } = await rpc().rpc("get_product_value_workspace", { p_facility_id: facilityId ?? null });
      if (error) throw error;
      return data as ProductValueWorkspace;
    },
    staleTime: 30_000,
  });
}

export function useCustomerValueDashboard() {
  return useQuery({
    queryKey: ["customer-value-dashboard"],
    queryFn: async (): Promise<CustomerValueDashboard> => {
      const { data, error } = await rpc().rpc("get_customer_value_dashboard");
      if (error) throw error;
      return data as CustomerValueDashboard;
    },
    staleTime: 60_000,
  });
}

export function useStaffingOptimization(facilityId?: string, from?: string, through?: string) {
  return useQuery({
    queryKey: ["staffing-optimization", facilityId, from, through],
    enabled: Boolean(facilityId && from && through),
    queryFn: async (): Promise<StaffingOptimizationSnapshot> => {
      const { data, error } = await rpc().rpc("get_staffing_optimization_snapshot", {
        p_facility_id: facilityId,
        p_from: from,
        p_through: through,
      });
      if (error) throw error;
      return data as StaffingOptimizationSnapshot;
    },
    staleTime: 30_000,
  });
}

export function useAdmissionsIntelligence(facilityId?: string) {
  return useQuery({
    queryKey: ["admissions-intelligence", facilityId ?? "portfolio"],
    queryFn: async (): Promise<AdmissionsIntelligenceSnapshot> => {
      const { data, error } = await rpc().rpc("get_admissions_intelligence_snapshot", { p_facility_id: facilityId ?? null });
      if (error) throw error;
      return data as AdmissionsIntelligenceSnapshot;
    },
    staleTime: 30_000,
  });
}

export function useSaveWorkflowAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ruleId?: string; facilityId?: string; name: string; description: string; triggerType: string;
      conditions?: Record<string, unknown>; actions: AutomationAction[]; state: "draft" | "active" | "paused" | "retired";
    }) => {
      const { data, error } = await rpc().rpc("save_workflow_automation_rule", {
        p_rule_id: input.ruleId ?? null, p_facility_id: input.facilityId ?? null,
        p_name: input.name, p_description: input.description, p_trigger_type: input.triggerType,
        p_conditions: input.conditions ?? {}, p_actions: input.actions, p_state: input.state,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useRunWorkflowAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ruleId: string; facilityId: string; subjectType?: string }) => {
      const { data, error } = await rpc().rpc("run_workflow_automation_now", {
        p_rule_id: input.ruleId, p_facility_id: input.facilityId,
        p_subject_type: input.subjectType ?? "manual", p_subject_id: crypto.randomUUID(), p_context: {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useCreateInspectionWarRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { facilityId: string; name: string; inspectionType: string; targetResponseAt?: string; leadProfileId?: string; notes?: string }) => {
      const { data, error } = await rpc().rpc("create_inspection_war_room", {
        p_facility_id: input.facilityId, p_name: input.name, p_inspection_type: input.inspectionType,
        p_target_response_at: input.targetResponseAt ?? null, p_lead_profile_id: input.leadProfileId ?? null,
        p_notes: input.notes ?? "",
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useAddWarRoomRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { warRoomId: string; title: string; description: string; ownerProfileId?: string; citationRef?: string; priority?: string; dueAt?: string }) => {
      const { data, error } = await rpc().rpc("add_inspection_war_room_request", {
        p_war_room_id: input.warRoomId, p_title: input.title, p_citation_ref: input.citationRef ?? "",
        p_description: input.description, p_owner_profile_id: input.ownerProfileId ?? null,
        p_priority: input.priority ?? "high", p_due_at: input.dueAt ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useUpdateWarRoomRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; status: string; responseNote: string }) => {
      const { data, error } = await rpc().rpc("update_inspection_war_room_request", {
        p_request_id: input.requestId, p_status: input.status, p_evidence_note: input.responseNote,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useInitializeImplementationProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; targetGoLiveOn?: string; ownerProfileId?: string; sourceSystems?: string[] }) => {
      const { data, error } = await rpc().rpc("initialize_implementation_project", {
        p_name: input.name, p_target_go_live_date: input.targetGoLiveOn ?? null,
        p_owner_profile_id: input.ownerProfileId ?? null, p_source_systems: input.sourceSystems ?? [],
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useUpdateImplementationTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { taskId: string; status: string; ownerProfileId?: string; dueOn?: string; note?: string }) => {
      const { data, error } = await rpc().rpc("update_implementation_task", {
        p_task_id: input.taskId, p_status: input.status, p_owner_profile_id: input.ownerProfileId ?? null,
        p_due_date: input.dueOn ?? null, p_evidence_note: input.note ?? "",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useSaveReportSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { reportDefinitionId: string; frequency: "daily" | "weekly" | "monthly"; timeZone: string; audience: Record<string, unknown>; deliveryMode: string }) => {
      const { data, error } = await rpc().rpc("save_report_schedule", {
        p_report_definition_id: input.reportDefinitionId, p_frequency: input.frequency,
        p_delivery_mode: input.deliveryMode, p_audience: input.audience, p_time_zone: input.timeZone,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useSetReportScheduleEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scheduleId: string; enabled: boolean }) => {
      const { data, error } = await rpc().rpc("set_report_schedule_enabled", { p_schedule_id: input.scheduleId, p_enabled: input.enabled });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useSaveCustomerValueBaseline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      hourlyAdminCost: number;
      annualSoftwareCost: number;
      reportExportMinutes: number;
      mockInspectionMinutes: number;
      courseCompletionMinutes: number;
      closedWorkItemMinutes: number;
      portalMessageMinutes: number;
      replacedSystems: string[];
      note: string;
    }) => {
      const { data, error } = await rpc().rpc("save_customer_value_baseline", {
        p_hourly_admin_cost: input.hourlyAdminCost, p_legacy_monthly_software_cost: input.annualSoftwareCost / 12,
        p_retired_tools: input.replacedSystems,
        p_time_saving_assumptions: {
          report_export_minutes: input.reportExportMinutes,
          mock_inspection_minutes: input.mockInspectionMinutes,
          course_completion_admin_minutes: input.courseCompletionMinutes,
          closed_work_item_minutes: input.closedWorkItemMinutes,
          portal_message_minutes: input.portalMessageMinutes,
        },
        p_notes: input.note,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useReviewCopilotActionDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { draftId: string; decision: "approve" | "reject"; reviewNote: string }) => {
      const { data, error } = await rpc().rpc("review_copilot_action_draft", {
        p_draft_id: input.draftId, p_decision: input.decision, p_review_note: input.reviewNote,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useCreateCopilotActionDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { facilityId: string; intent: string; title: string; sourceRunId?: string; actions: Array<Record<string, unknown>> }) => {
      const { data, error } = await rpc().rpc("create_copilot_action_draft", {
        p_facility_id: input.facilityId, p_intent: input.intent, p_title: input.title,
        p_source_run_id: input.sourceRunId ?? null, p_proposed_actions: input.actions,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidate(queryClient),
  });
}
