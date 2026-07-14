import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type ResidentServiceCalendarEvent = Tables<"resident_service_calendar_events">;
export type ResidentServiceCalendarStaff = Tables<"resident_service_calendar_event_staff">;
export type ResidentServiceCalendarFollowUp = Tables<"resident_service_calendar_follow_ups">;
export type FacilityTransportVehicle = Tables<"facility_transport_vehicles">;

export interface ResidentServiceCalendarEventView extends ResidentServiceCalendarEvent {
  resident: { id: string; first_name: string; last_name: string; room: string | null } | null;
  vehicle: Pick<FacilityTransportVehicle, "id" | "label" | "vehicle_type" | "license_plate" | "wheelchair_accessible"> | null;
  staff: Array<ResidentServiceCalendarStaff & {
    employee: { id: string; first_name: string; last_name: string; job_title: string } | null;
  }>;
  follow_ups: ResidentServiceCalendarFollowUp[];
}

export interface CalendarFilters {
  facilityId?: string;
  from: string;
  through: string;
  residentId?: string;
  eventType?: string;
  status?: string;
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["resident-services-calendar"] });
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
  queryClient.invalidateQueries({ queryKey: ["qapi"] });
}

export function useResidentServicesCalendar(filters: CalendarFilters) {
  return useQuery({
    queryKey: ["resident-services-calendar", "events", filters],
    queryFn: async () => {
      let query = supabase.from("resident_service_calendar_events").select(`
        *,
        resident:residents(id,first_name,last_name,room),
        vehicle:facility_transport_vehicles(id,label,vehicle_type,license_plate,wheelchair_accessible),
        staff:resident_service_calendar_event_staff(*,employee:employees(id,first_name,last_name,job_title)),
        follow_ups:resident_service_calendar_follow_ups(*)
      `).gte("starts_at", filters.from).lt("starts_at", filters.through).order("starts_at");
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.residentId) query = query.eq("resident_id", filters.residentId);
      if (filters.eventType) query = query.eq("event_type", filters.eventType);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ResidentServiceCalendarEventView[];
    },
  });
}

export function useFacilityTransportVehicles(facilityId?: string) {
  return useQuery({
    queryKey: ["resident-services-calendar", "vehicles", facilityId],
    queryFn: async () => {
      const { data, error } = await supabase.from("facility_transport_vehicles")
        .select("*").eq("facility_id", facilityId!).order("label");
      if (error) throw error;
      return data;
    },
    enabled: !!facilityId,
  });
}

export function useSaveFacilityTransportVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { facilityId: string; vehicleId?: string; label: string; vehicleType: string; licensePlate?: string; capacity: number; wheelchairAccessible: boolean; status: string; notes?: string }) => {
      const { data, error } = await supabase.rpc("upsert_facility_transport_vehicle" as never, {
        p_facility_id: input.facilityId,
        p_vehicle_id: input.vehicleId ?? null,
        p_label: input.label,
        p_vehicle_type: input.vehicleType,
        p_license_plate: input.licensePlate ?? null,
        p_capacity: input.capacity,
        p_wheelchair_accessible: input.wheelchairAccessible,
        p_status: input.status,
        p_notes: input.notes ?? null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useCreateResidentServiceCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { residentId: string; event: Json; staff: Json }) => {
      const { data, error } = await supabase.rpc("create_resident_service_calendar_event", {
        p_resident_id: input.residentId,
        p_event: input.event,
        p_staff: input.staff,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useRescheduleResidentServiceCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventId: string; startsAt: string; endsAt: string; reason: string }) => {
      const { data, error } = await supabase.rpc("reschedule_resident_service_calendar_event", {
        p_event_id: input.eventId,
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useRecordResidentServiceCalendarOutcome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventId: string; status: string; resolvedAt: string; reason?: string; returnInstructions?: string; followUps: Json; nextAppointmentAt?: string }) => {
      const { data, error } = await supabase.rpc("record_resident_service_calendar_outcome" as never, {
        p_event_id: input.eventId,
        p_status: input.status,
        p_resolved_at: input.resolvedAt,
        p_reason: input.reason ?? null,
        p_return_instructions: input.returnInstructions ?? null,
        p_follow_ups: input.followUps,
        p_next_appointment_at: input.nextAppointmentAt ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}
