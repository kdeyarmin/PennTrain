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

const PAGE_SIZE = 1000;
// Keep the UUID filter within proxy/request URL limits even for a long resident history.
const APPOINTMENT_ID_BATCH_SIZE = 100;
type PreparationRow = AppointmentPreparationItemLike & { appointment_id: string };

export function useResidentAppointments(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident-appointments", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const rows: AppointmentLike[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("resident_appointments")
          .select(APPOINTMENT_COLUMNS)
          .eq("resident_id", residentId!)
          .order("starts_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as AppointmentLike[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
      }
    },
  });
}

/**
 * Batch the resident's appointments and page each batch. A single capped response can omit a
 * required item and make an incomplete preparation list appear ready; a failure on any page must
 * reject the complete query so both the tab and Needs Attention can show the error.
 */
export function useResidentAppointmentPreparation(appointmentIds: string[]) {
  // Sorted so the key is stable regardless of the order the appointment list happens to arrive in;
  // an unsorted key refetches on every re-render that reorders the source array.
  const key = [...new Set(appointmentIds)].sort();
  return useQuery({
    queryKey: ["resident-appointment-preparation", key],
    enabled: key.length > 0,
    queryFn: async () => {
      const rows: PreparationRow[] = [];
      for (let index = 0; index < key.length; index += APPOINTMENT_ID_BATCH_SIZE) {
        const ids = key.slice(index, index + APPOINTMENT_ID_BATCH_SIZE);
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data, error } = await supabase
            .from("resident_appointment_preparation_items")
            .select("id, appointment_id, item_kind, label, required, ready, ready_at, note")
            .in("appointment_id", ids)
            .order("item_kind")
            .order("label")
            .order("id")
            .range(from, from + PAGE_SIZE - 1);
          if (error) throw error;
          const page = (data ?? []) as unknown as PreparationRow[];
          rows.push(...page);
          if (page.length < PAGE_SIZE) break;
        }
      }
      return rows;
    },
  });
}
