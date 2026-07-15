import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type EmergencyEvent = Tables<"emergency_events">;
export type EmergencyEventResident = Tables<"emergency_event_residents">;
export type EmergencyEventStaff = Tables<"emergency_event_staff">;
export type EmergencyResource = Tables<"emergency_resources">;
export type EmergencyInventoryItem = Tables<"emergency_inventory_items">;
export type ResidentEvacuationProfile = Tables<"resident_evacuation_profiles">;

export interface EmergencyEventListItem extends EmergencyEvent {
  facility: { id: string; name: string } | null;
  plan_version: { id: string; version_number: number; effective_date: string } | null;
  commander: { id: string; first_name: string; last_name: string } | null;
}

export interface EmergencyEventResidentView extends EmergencyEventResident {
  relocation_site: { id: string; name: string } | null;
  assigned_employee: { id: string; first_name: string; last_name: string } | null;
}

export interface EmergencyEventStaffView extends EmergencyEventStaff {
  employee: { id: string; first_name: string; last_name: string } | null;
}

const eventSelect = `
  *,
  facility:facilities(id,name),
  plan_version:emergency_plan_versions(id,version_number,effective_date),
  commander:profiles!emergency_events_incident_commander_profile_id_fkey(id,first_name,last_name)
`;

function invalidateEmergency(queryClient: ReturnType<typeof useQueryClient>, id?: string) {
  queryClient.invalidateQueries({ queryKey: ["emergency"] });
  if (id) queryClient.invalidateQueries({ queryKey: ["emergency", "event", id] });
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
}

export function useEmergencyEvents(filters: {
  organizationId?: string;
  facilityId?: string;
  status?: string;
} = {}) {
  return useQuery({
    queryKey: ["emergency", "events", filters],
    queryFn: async () => {
      let query = supabase
        .from("emergency_events")
        .select(eventSelect)
        .order("started_at", { ascending: false });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as EmergencyEventListItem[];
    },
  });
}

export function useEmergencyReadiness(facilityId?: string) {
  return useQuery({
    queryKey: ["emergency", "readiness", facilityId],
    enabled: Boolean(facilityId),
    queryFn: async () => {
      const [plans, versions, assignments, profiles, resources, inventory, residents] = await Promise.all([
        supabase
          .from("emergency_plans")
          .select("*,current_version:emergency_plan_versions!emergency_plans_current_version_fkey(*)")
          .eq("facility_id", facilityId!),
        supabase
          .from("emergency_plan_versions")
          .select("*")
          .eq("facility_id", facilityId!)
          .order("version_number", { ascending: false }),
        supabase
          .from("emergency_staff_assignments")
          .select("*,employee:employees(id,first_name,last_name,job_title,status)")
          .eq("facility_id", facilityId!)
          .order("emergency_role"),
        supabase
          .from("resident_evacuation_profiles")
          .select("*,resident:residents(id,first_name,last_name,room,status)")
          .eq("facility_id", facilityId!)
          .order("last_reviewed_at", { ascending: true }),
        supabase
          .from("emergency_resources")
          .select("*")
          .eq("facility_id", facilityId!)
          .order("resource_type")
          .order("name"),
        supabase
          .from("emergency_inventory_items")
          .select("*")
          .eq("facility_id", facilityId!)
          .order("inventory_type")
          .order("item_name"),
        supabase
          .from("residents")
          .select("id,first_name,last_name,room,status")
          .eq("facility_id", facilityId!)
          .eq("status", "active")
          .order("last_name"),
      ]);
      const failed = [plans, versions, assignments, profiles, resources, inventory, residents].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        plan: plans.data?.[0] ?? null,
        versions: versions.data ?? [],
        assignments: assignments.data ?? [],
        profiles: profiles.data ?? [],
        resources: resources.data ?? [],
        inventory: inventory.data ?? [],
        residents: residents.data ?? [],
      };
    },
  });
}

export function useEmergencyEvent(id?: string) {
  return useQuery({
    queryKey: ["emergency", "event", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const [event, residents, staff, timeline, communications, review, actions] = await Promise.all([
        supabase.from("emergency_events").select(eventSelect).eq("id", id!).single(),
        supabase
          .from("emergency_event_residents")
          .select(`
            *,
            relocation_site:emergency_resources!emergency_event_residents_relocation_site_id_fkey(id,name),
            assigned_employee:employees!emergency_event_residents_assigned_employee_id_fkey(id,first_name,last_name)
          `)
          .eq("emergency_event_id", id!)
          .order("resident_name_snapshot"),
        supabase
          .from("emergency_event_staff")
          .select("*,employee:employees(id,first_name,last_name)")
          .eq("emergency_event_id", id!)
          .order("employee_name_snapshot"),
        supabase
          .from("emergency_event_timeline")
          .select("*")
          .eq("emergency_event_id", id!)
          .order("occurred_at", { ascending: false }),
        supabase
          .from("emergency_communications")
          .select("*")
          .eq("emergency_event_id", id!)
          .order("occurred_at", { ascending: false }),
        supabase
          .from("emergency_after_action_reviews")
          .select("*")
          .eq("emergency_event_id", id!)
          .maybeSingle(),
        supabase
          .from("emergency_event_actions")
          .select("*,work_item:work_items(*)")
          .eq("emergency_event_id", id!),
      ]);
      const failed = [event, residents, staff, timeline, communications, review, actions].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        event: event.data as unknown as EmergencyEventListItem,
        residents: residents.data as unknown as EmergencyEventResidentView[],
        staff: staff.data as unknown as EmergencyEventStaffView[],
        timeline: timeline.data ?? [],
        communications: communications.data ?? [],
        review: review.data,
        actions: actions.data ?? [],
      };
    },
  });
}

export function usePublishEmergencyPlanVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      facilityId: string;
      title: string;
      effectiveDate: string;
      changeSummary: string;
      planSnapshot: Json;
    }) => {
      const { data, error } = await supabase.rpc("create_emergency_plan_version", {
        p_facility_id: input.facilityId,
        p_title: input.title,
        p_effective_date: input.effectiveDate,
        p_change_summary: input.changeSummary,
        p_plan_snapshot: input.planSnapshot,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEmergency(queryClient),
  });
}

export function useUpsertResidentEvacuationProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      assistanceLevel: string;
      mobilityNeeds: string;
      transportationNeeds: string;
      evacuationMethod: string;
      requiredEquipment: string;
      communicationNeeds: string;
      preferredRelocationNotes: string;
      notes: string;
    }) => {
      const { data, error } = await supabase.rpc("upsert_resident_evacuation_profile", {
        p_resident_id: input.residentId,
        p_assistance_level: input.assistanceLevel,
        p_mobility_needs: input.mobilityNeeds,
        p_transportation_needs: input.transportationNeeds,
        p_evacuation_method: input.evacuationMethod,
        p_required_equipment: input.requiredEquipment,
        p_communication_needs: input.communicationNeeds,
        p_preferred_relocation_notes: input.preferredRelocationNotes,
        p_notes: input.notes,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEmergency(queryClient),
  });
}

export function useAddEmergencyResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      facilityId: string;
      resourceType: string;
      name: string;
      contactName: string;
      phone: string;
      email: string;
      address: string;
      capacity?: number;
      contractReference: string;
      availabilityNotes: string;
    }) => {
      const { data, error } = await supabase
        .from("emergency_resources")
        .insert({
          organization_id: input.organizationId,
          facility_id: input.facilityId,
          resource_type: input.resourceType,
          name: input.name,
          contact_name: input.contactName || null,
          phone: input.phone || null,
          email: input.email || null,
          address: input.address || null,
          capacity: input.capacity ?? null,
          contract_reference: input.contractReference || null,
          availability_notes: input.availabilityNotes || null,
          last_verified_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEmergency(queryClient),
  });
}

export function useAddEmergencyInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      facilityId: string;
      inventoryType: string;
      itemName: string;
      quantity: number;
      unit: string;
      minimumQuantity: number;
      expirationDate?: string;
      status: string;
      location: string;
      notes: string;
      checkedBy?: string;
    }) => {
      const { data, error } = await supabase
        .from("emergency_inventory_items")
        .insert({
          organization_id: input.organizationId,
          facility_id: input.facilityId,
          inventory_type: input.inventoryType,
          item_name: input.itemName,
          quantity: input.quantity,
          unit: input.unit,
          minimum_quantity: input.minimumQuantity,
          expiration_date: input.expirationDate || null,
          status: input.status,
          location: input.location || null,
          notes: input.notes || null,
          checked_by: input.checkedBy || null,
          checked_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEmergency(queryClient),
  });
}

export function useAddEmergencyStaffAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      facilityId: string;
      employeeId: string;
      emergencyRole: string;
      responsibility: string;
      isBackup: boolean;
      createdBy?: string;
    }) => {
      const { data, error } = await supabase
        .from("emergency_staff_assignments")
        .insert({
          organization_id: input.organizationId,
          facility_id: input.facilityId,
          employee_id: input.employeeId,
          emergency_role: input.emergencyRole,
          responsibility: input.responsibility,
          is_backup: input.isBackup,
          created_by: input.createdBy || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEmergency(queryClient),
  });
}

export function useStartEmergencyEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      facilityId: string;
      eventMode: string;
      eventType: string;
      startedAt: string;
      summary: string;
      locationDescription: string;
      assemblyPoint: string;
      incidentCommander?: string;
    }) => {
      const { data, error } = await supabase.rpc("start_emergency_event", {
        p_facility_id: input.facilityId,
        p_event_mode: input.eventMode,
        p_event_type: input.eventType,
        p_started_at: input.startedAt,
        p_summary: input.summary,
        p_location_description: input.locationDescription,
        p_assembly_point: input.assemblyPoint,
        p_incident_commander: (input.incidentCommander || null) as unknown as string,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEmergency(queryClient),
  });
}

export function useRecordEmergencyAccountability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      subjectType: string;
      subjectId: string;
      status: string;
      assignedEmployeeId?: string;
      relocationSiteId?: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_emergency_accountability", {
        p_emergency_event_id: input.eventId,
        p_subject_type: input.subjectType,
        p_subject_id: input.subjectId,
        p_status: input.status,
        p_assigned_employee_id: input.assignedEmployeeId || undefined,
        p_relocation_site_id: input.relocationSiteId || undefined,
        p_notes: input.notes || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidateEmergency(queryClient, input.eventId),
  });
}

export function useAddEmergencyTimelineEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventId: string; eventType: string; description: string; occurredAt: string }) => {
      const { data, error } = await supabase.rpc("add_emergency_timeline_entry", {
        p_emergency_event_id: input.eventId,
        p_event_type: input.eventType,
        p_occurred_at: input.occurredAt,
        p_description: input.description,
        p_metadata: {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidateEmergency(queryClient, input.eventId),
  });
}

export function useLogEmergencyCommunication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      audience: string;
      recipientName: string;
      recipientContact: string;
      channel: string;
      deliveryStatus: string;
      message: string;
    }) => {
      const { data, error } = await supabase.rpc("log_emergency_communication", {
        p_emergency_event_id: input.eventId,
        p_audience: input.audience,
        p_resident_id: null as unknown as string,
        p_informal_support_id: null as unknown as string,
        p_recipient_name: input.recipientName,
        p_recipient_contact: input.recipientContact,
        p_channel: input.channel,
        p_delivery_status: input.deliveryStatus,
        p_message: input.message,
        p_occurred_at: new Date().toISOString(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidateEmergency(queryClient, input.eventId),
  });
}

export function useQueueDesignatedPersonNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventId: string; message: string; channel: string }) => {
      const { data, error } = await supabase.rpc("queue_designated_person_notifications", {
        p_emergency_event_id: input.eventId,
        p_message: input.message,
        p_channel: input.channel,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidateEmergency(queryClient, input.eventId),
  });
}

export function useSaveEmergencyAfterAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      status: string;
      responseSummary: string;
      strengths: string;
      gapsIdentified: string;
      lessonsLearned: string;
      correctiveActionPlan: string;
    }) => {
      const { data, error } = await supabase.rpc("save_emergency_after_action", {
        p_emergency_event_id: input.eventId,
        p_status: input.status,
        p_response_summary: input.responseSummary,
        p_strengths: input.strengths,
        p_gaps_identified: input.gapsIdentified,
        p_lessons_learned: input.lessonsLearned,
        p_corrective_action_plan: input.correctiveActionPlan,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidateEmergency(queryClient, input.eventId),
  });
}

export function useAddEmergencyCorrectiveAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      title: string;
      description: string;
      ownerProfileId: string;
      priority: string;
      dueAt: string;
    }) => {
      const { data, error } = await supabase.rpc("add_emergency_corrective_action", {
        p_emergency_event_id: input.eventId,
        p_title: input.title,
        p_description: input.description,
        p_owner_profile_id: input.ownerProfileId,
        p_priority: input.priority,
        p_due_at: input.dueAt,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidateEmergency(queryClient, input.eventId),
  });
}

export function useTransitionEmergencyEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventId: string; targetStatus: string; reason: string }) => {
      const { data, error } = await supabase.rpc("transition_emergency_event", {
        p_emergency_event_id: input.eventId,
        p_target_status: input.targetStatus,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidateEmergency(queryClient, input.eventId),
  });
}
