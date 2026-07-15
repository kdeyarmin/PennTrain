import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface MyShiftWorkspace {
  employee: { id: string; name: string; status: string; facility_id?: string | null } | null;
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

export interface ShiftReportEntry {
  id: string;
  organization_id: string;
  facility_id: string;
  resident_id: string | null;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  narrative: string;
  status: "open" | "carried_forward" | "reviewed" | "resolved" | "voided";
  author_profile_id: string;
  follow_up_owner_profile_id: string | null;
  requires_acknowledgement: boolean;
  review_due_at: string;
  escalation_level: number;
  linked_incident_id: string | null;
  linked_change_event_id: string | null;
  linked_work_order_id: string | null;
  linked_work_item_id: string | null;
  resolution_note: string | null;
  created_at: string;
  facilities?: { name: string } | null;
  residents?: { first_name: string; last_name: string } | null;
  owner?: { first_name: string; last_name: string } | null;
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

export function useListShiftReportEntries(facilityId?: string, includeClosed = false) {
  return useQuery({
    queryKey: ["shift-report-entries", facilityId ?? "all", includeClosed],
    queryFn: async (): Promise<ShiftReportEntry[]> => {
      let query = asRpc().from("shift_report_entries")
        .select("*, facilities(name), residents(first_name,last_name), owner:profiles!shift_report_entries_follow_up_owner_profile_id_fkey(first_name,last_name)")
        .order("review_due_at", { ascending: true });
      if (facilityId) query = query.eq("facility_id", facilityId);
      if (!includeClosed) query = query.in("status", ["open", "carried_forward", "reviewed"]);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as ShiftReportEntry[];
    },
    staleTime: 15_000,
  });
}

export function useAcknowledgeShiftReportEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await asRpc().rpc("acknowledge_shift_report_entry", { p_entry_id: entryId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["shift-report-entries"] });
    },
  });
}

export function useTriageShiftReportEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entryId: string; ownerProfileId?: string | null; action: "review" | "carry_forward" | "void"; note: string }) => {
      const { data, error } = await asRpc().rpc("triage_shift_report_entry", {
        p_entry_id: input.entryId,
        p_owner_profile_id: input.ownerProfileId ?? null,
        p_action: input.action,
        p_note: input.note,
      });
      if (error) throw error;
      return data as ShiftReportEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-report-entries"] });
      queryClient.invalidateQueries({ queryKey: ["daily-operations-command-center"] });
      queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] });
    },
  });
}

export function useConvertShiftReportEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entryId: string; destination: "incident" | "maintenance" | "change_of_condition" | "work_item"; reason: string }) => {
      const { data, error } = await asRpc().rpc("convert_shift_report_entry", {
        p_entry_id: input.entryId,
        p_destination: input.destination,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as Record<string, string | null>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-report-entries"] });
      queryClient.invalidateQueries({ queryKey: ["daily-operations-command-center"] });
      queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useResolveShiftReportEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ entryId, note }: { entryId: string; note: string }) => {
      const { error } = await asRpc().rpc("resolve_shift_report_entry", { p_entry_id: entryId, p_resolution_note: note });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-report-entries"] });
      queryClient.invalidateQueries({ queryKey: ["daily-operations-command-center"] });
      queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] });
    },
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

export function useClaimOpenShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (opportunityId: string) => {
      const { data, error } = await asRpc().rpc("claim_open_shift", { p_opportunity_id: opportunityId });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
      queryClient.invalidateQueries({ queryKey: ["workforce-self-service-queues"] });
    },
  });
}

export interface ShiftSwapCandidate {
  assignment_id: string;
  employee_name: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  facility_name: string;
  unit_name: string | null;
}

export function useShiftSwapCandidates(assignmentId?: string | null) {
  return useQuery({
    queryKey: ["shift-swap-candidates", assignmentId],
    enabled: Boolean(assignmentId),
    queryFn: async (): Promise<ShiftSwapCandidate[]> => {
      const { data, error } = await asRpc().rpc("list_shift_swap_candidates", { p_requester_assignment_id: assignmentId });
      if (error) throw error;
      return (data ?? []) as ShiftSwapCandidate[];
    },
    staleTime: 30_000,
  });
}

export function useRequestShiftSwap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requesterAssignmentId: string; targetAssignmentId: string; reason: string }) => {
      const { data, error } = await asRpc().rpc("request_shift_swap", {
        p_requester_assignment_id: input.requesterAssignmentId,
        p_target_assignment_id: input.targetAssignmentId,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["shift-swap-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["workforce-self-service-queues"] });
    },
  });
}

export function useCancelTimeOffRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) => {
      const { error } = await asRpc().rpc("cancel_time_off_request", { p_request_id: requestId, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-shift-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["workforce-self-service-queues"] });
    },
  });
}

export interface WorkforceSelfServiceQueues {
  timeOff: Record<string, any>[];
  openShiftClaims: Record<string, any>[];
  shiftSwaps: Record<string, any>[];
}

export function useWorkforceSelfServiceQueues(facilityId?: string) {
  return useQuery({
    queryKey: ["workforce-self-service-queues", facilityId ?? "all"],
    queryFn: async (): Promise<WorkforceSelfServiceQueues> => {
      let timeOffQuery = asRpc().from("workforce_time_off_requests")
        .select("*, employees(first_name,last_name), facilities(name)")
        .eq("status", "pending")
        .order("starts_at");
      let claimQuery = asRpc().from("open_shift_claims")
        .select("*, employees(first_name,last_name), open_shift_opportunities!inner(*, facilities(name), facility_units(name))")
        .in("claim_status", ["pending_approval", "waitlisted"])
        .order("requested_at");
      let swapQuery = asRpc().from("shift_swap_requests")
        .select("*, facilities(name), requester:employees!shift_swap_requests_requester_employee_id_fkey(first_name,last_name), target:employees!shift_swap_requests_target_employee_id_fkey(first_name,last_name), requester_assignment:shift_assignments!shift_swap_requests_requester_assignment_id_fkey(shift_date,start_time,end_time), target_assignment:shift_assignments!shift_swap_requests_target_assignment_id_fkey(shift_date,start_time,end_time)")
        .eq("status", "pending")
        .order("requested_at");
      if (facilityId) {
        timeOffQuery = timeOffQuery.eq("facility_id", facilityId);
        claimQuery = claimQuery.eq("open_shift_opportunities.facility_id", facilityId);
        swapQuery = swapQuery.eq("facility_id", facilityId);
      }
      const [timeOff, claims, swaps] = await Promise.all([timeOffQuery, claimQuery, swapQuery]);
      if (timeOff.error) throw timeOff.error;
      if (claims.error) throw claims.error;
      if (swaps.error) throw swaps.error;
      return { timeOff: timeOff.data ?? [], openShiftClaims: claims.data ?? [], shiftSwaps: swaps.data ?? [] };
    },
    staleTime: 15_000,
  });
}

export function useDecideTimeOffRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; status: "approved" | "denied"; reason: string }) => {
      const { error } = await asRpc().rpc("decide_time_off_request", { p_request_id: input.requestId, p_status: input.status, p_manager_reason: input.reason });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workforce-self-service-queues"] }),
  });
}

export function useDecideOpenShiftClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { claimId: string; approve: boolean; reason: string }) => {
      const { error } = await asRpc().rpc("decide_open_shift_claim", { p_claim_id: input.claimId, p_approve: input.approve, p_reason: input.reason });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workforce-self-service-queues"] });
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
    },
  });
}

export function useDecideShiftSwap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; approve: boolean; reason: string }) => {
      const { error } = await asRpc().rpc("decide_shift_swap", { p_swap_request_id: input.requestId, p_approve: input.approve, p_reason: input.reason });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workforce-self-service-queues"] });
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
    },
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
