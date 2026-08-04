import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";

/**
 * Resident appointment WRITES (program plan item 1 -- the Appointments tab).
 *
 * Split from `useResidentAppointments.ts` so the resident route shell, which imports the two read
 * queries to feed the Needs Attention panel, does not also carry seven mutations it never calls.
 * Only `AppointmentsTab.tsx` and `AppointmentDialogs.tsx` import this module, and both are inside
 * the tab's lazy chunk.
 */

function useAppointmentInvalidation(residentId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["resident-appointments", residentId] });
    queryClient.invalidateQueries({ queryKey: ["resident-appointment-preparation"] });
    // The timeline unions appointments as of 20260804110000, and the needs-attention panel reads
    // them. Leaving either stale is how a user acts on a card they have already cleared.
    queryClient.invalidateQueries({ queryKey: ["resident-timeline", residentId] });
    queryClient.invalidateQueries({ queryKey: ["resident-needs-attention", residentId] });
    queryClient.invalidateQueries({ queryKey: ["work-items"] });
  };
}

export function useSetAppointmentPreparationItem(residentId: string) {
  const invalidate = useAppointmentInvalidation(residentId);
  return useMutation({
    mutationFn: async (input: { itemId: string; ready: boolean; note?: string }) => {
      const { data, error } = await supabase.rpc("set_appointment_preparation_item" as never, {
        p_item_id: input.itemId,
        p_ready: input.ready,
        p_note: input.note ?? null,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: invalidate,
  });
}

export function useAddAppointmentPreparationItem(residentId: string) {
  const invalidate = useAppointmentInvalidation(residentId);
  return useMutation({
    mutationFn: async (input: {
      appointmentId: string;
      itemKind: "document" | "equipment" | "task";
      label: string;
      required?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("add_appointment_preparation_item" as never, {
        p_appointment_id: input.appointmentId,
        p_item_kind: input.itemKind,
        p_label: input.label,
        p_required: input.required ?? true,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

export function useCompleteAppointmentPreparation(residentId: string) {
  const invalidate = useAppointmentInvalidation(residentId);
  return useMutation({
    mutationFn: async (input: { appointmentId: string; note?: string }) => {
      const { data, error } = await supabase.rpc("complete_appointment_preparation" as never, {
        p_appointment_id: input.appointmentId,
        p_note: input.note ?? null,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: invalidate,
  });
}

export function useRecordAppointmentOutcome(residentId: string) {
  const invalidate = useAppointmentInvalidation(residentId);
  return useMutation({
    mutationFn: async (input: {
      appointmentId: string;
      status: "attended" | "canceled" | "no_show" | "follow_up_required" | "closed";
      outcomeSummary?: string;
      followUpDueAt?: string;
      // 'acknowledged' is deliberately absent: the server refuses it here because this call carries
      // no note and no acknowledger. Use `useAcknowledgeAppointmentNewOrder`.
      newOrderAckStatus?: "not_applicable" | "pending_review";
      uploadedDocumentId?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_appointment_outcome" as never, {
        p_appointment_id: input.appointmentId,
        p_status: input.status,
        p_outcome_summary: input.outcomeSummary ?? null,
        p_follow_up_due_at: input.followUpDueAt ?? null,
        p_new_order_ack_status: input.newOrderAckStatus ?? "not_applicable",
        p_uploaded_document_id: input.uploadedDocumentId ?? null,
      } as never);
      if (error) throw error;
      // The work item id, or null when the outcome needed no follow-up. Callers distinguish the two.
      return data as string | null;
    },
    onSuccess: invalidate,
  });
}

export function useAcknowledgeAppointmentNewOrder(residentId: string) {
  const invalidate = useAppointmentInvalidation(residentId);
  return useMutation({
    mutationFn: async (input: { appointmentId: string; note: string }) => {
      const { data, error } = await supabase.rpc("acknowledge_appointment_new_order" as never, {
        p_appointment_id: input.appointmentId,
        p_note: input.note,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: invalidate,
  });
}

export function useCompleteAppointmentFollowUp(residentId: string) {
  const invalidate = useAppointmentInvalidation(residentId);
  return useMutation({
    mutationFn: async (input: { appointmentId: string; note?: string }) => {
      const { data, error } = await supabase.rpc("complete_appointment_follow_up" as never, {
        p_appointment_id: input.appointmentId,
        p_note: input.note ?? null,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: invalidate,
  });
}

export function useRescheduleAppointment(residentId: string) {
  const invalidate = useAppointmentInvalidation(residentId);
  return useMutation({
    mutationFn: async (input: {
      appointmentId: string;
      startsAt: string;
      reason: string;
      expectedReturnAt?: string;
      pickupAt?: string;
    }) => {
      const { data, error } = await supabase.rpc("reschedule_resident_appointment" as never, {
        p_appointment_id: input.appointmentId,
        p_starts_at: input.startsAt,
        p_reason: input.reason,
        p_expected_return_at: input.expectedReturnAt ?? null,
        p_pickup_at: input.pickupAt ?? null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

/**
 * Scheduling from the resident's own record. Same RPC as the care-delivery page's version; this one
 * invalidates the resident-scoped keys the tab reads, which that one does not know about.
 */
export function useScheduleAppointmentForResident(residentId: string) {
  const invalidate = useAppointmentInvalidation(residentId);
  return useMutation({
    mutationFn: async (input: {
      appointmentType: string;
      location: string;
      startsAt: string;
      expectedReturnAt?: string;
      providerName?: string;
      transportationProvider?: string;
      vehicleIdentifier?: string;
      pickupAt?: string;
      documentsRequired?: string[];
      equipmentRequired?: string[];
      preparationChecklist?: Json;
    }) => {
      const { data, error } = await supabase.rpc("schedule_resident_appointment" as never, {
        p_resident_id: residentId,
        p_appointment_type: input.appointmentType,
        p_location: input.location,
        p_starts_at: input.startsAt,
        p_expected_return_at: input.expectedReturnAt ?? null,
        p_provider_name: input.providerName ?? null,
        p_transportation_provider: input.transportationProvider ?? null,
        p_vehicle_identifier: input.vehicleIdentifier ?? null,
        p_driver_employee_id: null,
        p_escort_employee_id: null,
        p_pickup_at: input.pickupAt ?? null,
        p_documents_required: input.documentsRequired ?? [],
        p_equipment_required: input.equipmentRequired ?? [],
        p_preparation_checklist: input.preparationChecklist ?? [],
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}
