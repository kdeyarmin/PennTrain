import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AppointmentLike, AppointmentPreparationItemLike } from "@/lib/residentAppointments";

/**
 * Resident appointment READS (program plan item 1 -- the Appointments tab).
 *
 * Reads only, and deliberately so. `ResidentDetail.tsx` -- the route shell, which is separately
 * bundle-budgeted -- needs these two queries to feed the Needs Attention panel, and it needs none of
 * the seven mutations. Those live in `useResidentAppointmentMutations.ts` and are imported only by
 * the tab's own lazy chunk, so scheduling and acknowledgement code does not ride along in the shell
 * of every resident view. Keeping them in one module cost the shell ~4 KiB against a budget whose
 * whole purpose is to notice exactly that.
 *
 * `useScheduleResidentAppointment` also lives in `useResidentCareDelivery.ts`, called from the
 * facility-wide care-delivery page; that one stays where it is.
 */

const APPOINTMENT_COLUMNS = [
  "id", "resident_id", "appointment_type", "provider_name", "location", "starts_at",
  "expected_return_at", "pickup_at", "transportation_provider", "vehicle_identifier",
  "driver_employee_id", "escort_employee_id", "status", "outcome_summary", "new_order_ack_status",
  "new_order_ack_at", "new_order_ack_note", "follow_up_due_at", "follow_up_completed_at",
  "follow_up_work_item_id", "preparation_completed_at", "cancellation_reason",
  "rescheduled_to_appointment_id",
].join(", ");

export function useResidentAppointments(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident-appointments", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_appointments")
        .select(APPOINTMENT_COLUMNS)
        .eq("resident_id", residentId!)
        .order("starts_at", { ascending: false });
      if (error) throw error;
      return data as unknown as AppointmentLike[];
    },
  });
}

/**
 * Every preparation item for the resident's appointments in one query rather than one per row.
 * The tab renders a list, and a per-appointment query would fan out to N requests for a screen
 * whose whole purpose is to be read at a glance before a shift.
 */
export function useResidentAppointmentPreparation(appointmentIds: string[]) {
  // Sorted so the key is stable regardless of the order the appointment list happens to arrive in;
  // an unsorted key refetches on every re-render that reorders the source array.
  const key = [...appointmentIds].sort();
  return useQuery({
    queryKey: ["resident-appointment-preparation", key],
    enabled: key.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_appointment_preparation_items")
        .select("id, appointment_id, item_kind, label, required, ready, ready_at, note")
        .in("appointment_id", key)
        .order("item_kind")
        .order("label");
      if (error) throw error;
      return data as unknown as (AppointmentPreparationItemLike & { appointment_id: string })[];
    },
  });
}
