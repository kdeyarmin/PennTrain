import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type WorkOrder = Tables<"work_orders">;
export type WorkOrderHistory = Tables<"work_order_history">;
export type MaintenanceDocument = Tables<"maintenance_documents">;
export type MaintenanceLocation = Tables<"maintenance_locations">;
export type PreventiveMaintenanceSchedule = Tables<"preventive_maintenance_schedules">;

export interface WorkOrderFilters {
  facilityId?: string;
  status?: string;
  priority?: string;
  inspectionItemId?: string;
  sourceInspectionEventId?: string;
}

export function useListWorkOrders(filters: WorkOrderFilters = {}) {
  return useQuery({
    queryKey: ["work_orders", filters],
    queryFn: async () => {
      let query = supabase.from("work_orders").select("*").order("created_at", { ascending: false });
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.priority) query = query.eq("priority", filters.priority);
      if (filters.inspectionItemId) query = query.eq("inspection_item_id", filters.inspectionItemId);
      if (filters.sourceInspectionEventId) query = query.eq("source_inspection_event_id", filters.sourceInspectionEventId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetWorkOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["work_orders", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("work_orders").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useListWorkOrderHistory(workOrderId: string | undefined) {
  return useQuery({
    queryKey: ["work_order_history", workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_history").select("*").eq("work_order_id", workOrderId!).order("id", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workOrderId,
  });
}

export interface CreateWorkOrderInput {
  facilityId: string;
  problemDescription: string;
  inspectionItemId?: string | null;
  maintenanceLocationId?: string | null;
  locationDetail?: string | null;
  roomNumber?: string | null;
  safetyRisk: string;
  priority: string;
  temporaryProtectiveAction?: string | null;
  assignedEmployeeId?: string | null;
  externalVendor?: string | null;
  targetCompletionAt?: string | null;
  partsNeeded?: string | null;
  estimatedCost?: number | null;
  residentImpact?: string | null;
}

function invalidateWorkOrders(queryClient: ReturnType<typeof useQueryClient>, id?: string) {
  queryClient.invalidateQueries({ queryKey: ["work_orders"] });
  queryClient.invalidateQueries({ queryKey: ["work_order_history"] });
  if (id) queryClient.invalidateQueries({ queryKey: ["work_orders", id] });
  queryClient.invalidateQueries({ queryKey: ["inspection_events"] });
  queryClient.invalidateQueries({ queryKey: ["inspection_items"] });
}

export function useCreateWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWorkOrderInput) => {
      const { data, error } = await supabase.rpc("create_work_order", {
        p_facility_id: input.facilityId,
        p_problem_description: input.problemDescription,
        p_inspection_item_id: input.inspectionItemId ?? undefined,
        p_maintenance_location_id: input.maintenanceLocationId ?? undefined,
        p_location_detail: input.locationDetail ?? undefined,
        p_room_number: input.roomNumber ?? undefined,
        p_safety_risk: input.safetyRisk,
        p_priority: input.priority,
        p_temporary_protective_action: input.temporaryProtectiveAction ?? undefined,
        p_assigned_employee_id: input.assignedEmployeeId ?? undefined,
        p_external_vendor: input.externalVendor ?? undefined,
        p_target_completion_at: input.targetCompletionAt ?? undefined,
        p_parts_needed: input.partsNeeded ?? undefined,
        p_estimated_cost: input.estimatedCost ?? undefined,
        p_resident_impact: input.residentImpact ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (id) => invalidateWorkOrders(queryClient, id),
  });
}

export interface UpdateWorkOrderDetailsInput {
  id: string;
  locationDetail?: string | null;
  roomNumber?: string | null;
  safetyRisk: string;
  priority: string;
  temporaryProtectiveAction?: string | null;
  assignedEmployeeId?: string | null;
  externalVendor?: string | null;
  targetCompletionAt?: string | null;
  partsNeeded?: string | null;
  estimatedCost?: number | null;
  residentImpact?: string | null;
}

export function useUpdateWorkOrderDetails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateWorkOrderDetailsInput) => {
      const { error } = await supabase.rpc("update_work_order_details" as never, {
        p_work_order_id: input.id,
        p_location_detail: input.locationDetail ?? "",
        p_room_number: input.roomNumber ?? "",
        p_safety_risk: input.safetyRisk,
        p_priority: input.priority,
        p_temporary_protective_action: input.temporaryProtectiveAction ?? "",
        p_assigned_employee_id: input.assignedEmployeeId ?? null,
        p_external_vendor: input.externalVendor ?? "",
        p_target_completion_at: input.targetCompletionAt ?? null,
        p_parts_needed: input.partsNeeded ?? "",
        p_estimated_cost: input.estimatedCost ?? null,
        p_resident_impact: input.residentImpact ?? "",
      } as never);
      if (error) throw error;
    },
    onSuccess: (_data, input) => invalidateWorkOrders(queryClient, input.id),
  });
}

export interface TransitionWorkOrderInput {
  id: string;
  targetStatus: string;
  notes: string;
  actualCost?: number | null;
  downtimeStartedAt?: string | null;
  downtimeEndedAt?: string | null;
}

export function useTransitionWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TransitionWorkOrderInput) => {
      const { error } = await supabase.rpc("transition_work_order", {
        p_work_order_id: input.id,
        p_target_status: input.targetStatus,
        p_notes: input.notes,
        p_actual_cost: input.actualCost ?? undefined,
        p_downtime_started_at: input.downtimeStartedAt ?? undefined,
        p_downtime_ended_at: input.downtimeEndedAt ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => invalidateWorkOrders(queryClient, input.id),
  });
}

export function useVerifyWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, notes }: { id: string; decision: "verified" | "reopened"; notes: string }) => {
      const { error } = await supabase.rpc("verify_work_order", {
        p_work_order_id: id,
        p_decision: decision,
        p_verification_notes: notes,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => invalidateWorkOrders(queryClient, input.id),
  });
}

export function useListMaintenanceLocations(facilityId?: string) {
  return useQuery({
    queryKey: ["maintenance_locations", facilityId],
    queryFn: async () => {
      let query = supabase.from("maintenance_locations").select("*").order("label");
      if (facilityId) query = query.eq("facility_id", facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetMaintenanceLocationByQrToken(qrToken: string | undefined) {
  return useQuery({
    queryKey: ["maintenance_locations", "qr", qrToken],
    queryFn: async () => {
      const { data, error } = await supabase.from("maintenance_locations").select("*").eq("qr_token", qrToken!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!qrToken,
  });
}

export function useCreateMaintenanceLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TablesInsert<"maintenance_locations">) => {
      const { data, error } = await supabase.from("maintenance_locations").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance_locations"] }),
  });
}

export function useListPreventiveMaintenanceSchedules(facilityId?: string) {
  return useQuery({
    queryKey: ["preventive_maintenance_schedules", facilityId],
    queryFn: async () => {
      let query = supabase.from("preventive_maintenance_schedules").select("*").order("next_due_date");
      if (facilityId) query = query.eq("facility_id", facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePreventiveMaintenanceSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TablesInsert<"preventive_maintenance_schedules">) => {
      const { data, error } = await supabase.from("preventive_maintenance_schedules").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["preventive_maintenance_schedules"] }),
  });
}

export function useUpdatePreventiveMaintenanceSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: TablesUpdate<"preventive_maintenance_schedules"> & { id: string }) => {
      const { data, error } = await supabase.from("preventive_maintenance_schedules").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["preventive_maintenance_schedules"] }),
  });
}

export function useGenerateDuePreventiveMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (asOf?: string) => {
      const { data, error } = await supabase.rpc("generate_due_preventive_maintenance_work_orders", {
        p_as_of: asOf,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preventive_maintenance_schedules"] });
      invalidateWorkOrders(queryClient);
    },
  });
}

export function useListMaintenanceDocuments(parent: { workOrderId?: string; inspectionItemId?: string }) {
  return useQuery({
    queryKey: ["maintenance_documents", parent],
    queryFn: async () => {
      let query = supabase.from("maintenance_documents").select("*").order("created_at", { ascending: false });
      if (parent.workOrderId) query = query.eq("work_order_id", parent.workOrderId);
      if (parent.inspectionItemId) query = query.eq("inspection_item_id", parent.inspectionItemId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!(parent.workOrderId || parent.inspectionItemId),
  });
}

export interface UploadMaintenanceDocumentInput {
  file: File;
  organizationId: string;
  facilityId: string;
  documentType: MaintenanceDocument["document_type"];
  workOrderId?: string;
  inspectionItemId?: string;
  documentLabel?: string;
}

export function useUploadMaintenanceDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadMaintenanceDocumentInput) => {
      const parentId = input.workOrderId ?? input.inspectionItemId;
      if (!parentId) throw new Error("A work order or inspection item is required");
      const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${input.organizationId}/${input.facilityId}/${parentId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("maintenance-documents").upload(path, input.file);
      if (uploadError) throw uploadError;
      const { data, error } = await supabase.from("maintenance_documents").insert({
        organization_id: input.organizationId,
        facility_id: input.facilityId,
        work_order_id: input.workOrderId ?? null,
        inspection_item_id: input.inspectionItemId ?? null,
        document_type: input.documentType,
        storage_path: path,
        file_name: input.file.name,
        file_type: input.file.type || "application/octet-stream",
        file_size: input.file.size,
        document_label: input.documentLabel ?? null,
      }).select().single();
      if (error) {
        await supabase.storage.from("maintenance-documents").remove([path]);
        throw error;
      }
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance_documents"] }),
  });
}

export function useMaintenanceDocumentSignedUrl() {
  return useMutation({
    mutationFn: async (doc: MaintenanceDocument) => {
      const { error: logError } = await supabase.rpc("log_maintenance_document_access", { p_document_id: doc.id });
      if (logError) throw logError;
      const { data, error } = await supabase.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function useDeleteMaintenanceDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: MaintenanceDocument) => {
      const { error: storageError } = await supabase.storage.from(doc.storage_bucket).remove([doc.storage_path]);
      if (storageError) throw storageError;
      const { error } = await supabase.from("maintenance_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance_documents"] }),
  });
}
