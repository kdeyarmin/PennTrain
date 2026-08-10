import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type TrainingClass = Tables<"training_classes">;
export type TrainingClassInsert = TablesInsert<"training_classes">;
export type TrainingClassUpdate = TablesUpdate<"training_classes">;
export type TrainingClassAttendee = Tables<"training_class_attendees">;
export type TrainingClassAttendeeInsert = TablesInsert<"training_class_attendees">;

export interface ListTrainingClassesFilters {
  facilityId?: string;
  trainerProfileId?: string;
  /** When true, only scheduled/in_progress classes (enrollable). */
  enrollableOnly?: boolean;
}

export function useListTrainingClasses(filters: ListTrainingClassesFilters = {}) {
  return useQuery({
    queryKey: ["training_classes", filters],
    queryFn: async () => {
      let query = supabase.from("training_classes").select("*").order("class_date", { ascending: false });
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.trainerProfileId) query = query.eq("trainer_profile_id", filters.trainerProfileId);
      if (filters.enrollableOnly) query = query.in("status", ["scheduled", "in_progress"]);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetTrainingClass(id: string | undefined) {
  return useQuery({
    queryKey: ["training_classes", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_classes").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useListClassAttendees(classId: string | undefined) {
  return useQuery({
    queryKey: ["training_class_attendees", classId],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_class_attendees").select("*").eq("class_id", classId!);
      if (error) throw error;
      return data;
    },
    enabled: !!classId,
  });
}

// Per-class attendee counts for list views (e.g. the classes list, the trainer
// dashboard's recent-classes widget) that need a count per row without issuing one
// query per class. Shares a single queryKey so it can be invalidated consistently by
// every attendee-mutating hook below, instead of each caller rolling its own ad-hoc
// query that mutations don't know to invalidate.
export function useClassAttendeeCounts() {
  return useQuery({
    queryKey: ["training_class_attendees", "all-counts"],
    queryFn: async () => {
      // PostgREST caps a single select. Page through every attendee row so list-view counts stay
      // accurate once total attendees exceed max-rows (commonly 1000).
      const pageSize = 1000;
      const counts: Record<string, number> = {};
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("training_class_attendees")
          .select("class_id")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        for (const row of data ?? []) counts[row.class_id] = (counts[row.class_id] ?? 0) + 1;
        if (!data || data.length < pageSize) break;
      }
      return counts;
    },
  });
}

function invalidateTrainerDashboard(queryClient: ReturnType<typeof useQueryClient>) {
  // Class create/update/complete and attendee changes alter the trainer dashboard summary
  // (total/draft counts, today's list, recent list + attendee counts).
  void queryClient.invalidateQueries({ queryKey: ["trainer_dashboard_summary"] });
}

export function useCreateTrainingClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TrainingClassInsert) => {
      const { data, error } = await supabase.from("training_classes").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_classes"] });
      invalidateTrainerDashboard(queryClient);
    },
  });
}

export function useUpdateTrainingClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: TrainingClassUpdate & { id: string }) => {
      const { data, error } = await supabase.from("training_classes").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_classes"] });
      invalidateTrainerDashboard(queryClient);
    },
  });
}

export function useAddClassAttendee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TrainingClassAttendeeInsert) => {
      const { data, error } = await supabase.from("training_class_attendees").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", variables.class_id] });
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", "all-counts"] });
      invalidateTrainerDashboard(queryClient);
    },
  });
}

export function useUpdateClassAttendee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, classId, attended }: { id: string; classId: string; attended: boolean }) => {
      const { data, error } = await supabase.from("training_class_attendees").update({ attended }).eq("id", id).select().single();
      if (error) throw error;
      return { ...data, classId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", data.classId] });
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", "all-counts"] });
      invalidateTrainerDashboard(queryClient);
    },
  });
}

export function useCompleteTrainingClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (classId: string) => {
      const { error } = await supabase.rpc("complete_training_class", { p_class_id: classId });
      if (error) throw error;
    },
    onSuccess: (_data, classId) => {
      queryClient.invalidateQueries({ queryKey: ["training_classes"] });
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", classId] });
      queryClient.invalidateQueries({ queryKey: ["training_records"] });
      // complete_training_class() inserts compliant training records and runs
      // recalculate_compliance_core, so hour buckets and alerts change too.
      queryClient.invalidateQueries({ queryKey: ["training_hour_buckets"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      invalidateTrainerDashboard(queryClient);
    },
  });
}

// ---------------------------------------------------------------------------
// QR / kiosk check-in.
//
// The QR code encodes a short-lived token (not the class id directly) --
// generate_class_checkin_token() rotates it every ~30s (see the polling
// interval in ClassDetail.tsx) so a photographed or shoulder-surfed QR stops
// working within seconds. checkin_via_token()/checkin_via_kiosk_pin() both
// toggle: first call sets checked_in_at, a second call (once already checked
// in) sets checked_out_at -- the "scan to check in, scan again to check out"
// convention used throughout this feature.
// ---------------------------------------------------------------------------

/**
 * Correcting a class that has already been completed (BACKLOG.md G6).
 *
 * THE GAP THESE CLOSE. `complete_training_class` is wired; `correct_completed_training_class` and
 * `correct_completed_class_attendee` were not, by anything. Those RPCs exist *because* a completed
 * class is immutable evidence -- the page turns read-only at completion, and a database trigger
 * refuses writes unless `app.completed_class_correction` is set, which only these two functions do.
 * So the sanctioned correction path was the one path with no way in, and a mis-marked attendee was
 * uncorrectable through the product.
 *
 * Both refuse a reason shorter than ten characters, and the class correction refuses any field
 * outside class_name / location / notes / roster_document_id -- hours and dates are what the
 * training record was computed from, so they are not "descriptive".
 */
export function useCorrectCompletedTrainingClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      classId: string;
      patch: { class_name?: string; location?: string; notes?: string };
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("correct_completed_training_class" as never, {
        p_class_id: input.classId,
        p_patch: input.patch,
        p_reason: input.reason,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["training_classes"] });
      queryClient.invalidateQueries({ queryKey: ["training_classes", input.classId] });
    },
  });
}

export function useCorrectCompletedClassAttendee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      classId: string;
      employeeId: string;
      action: "upsert" | "delete";
      attended: boolean;
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("correct_completed_class_attendee" as never, {
        p_class_id: input.classId,
        p_employee_id: input.employeeId,
        p_action: input.action,
        p_attended: input.attended,
        p_reason: input.reason,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", input.classId] });
      // `useClassAttendeeCounts` keys on ["training_class_attendees", "all-counts"], which is what
      // the add/update mutations above already invalidate. The key this used to name existed
      // nowhere, so class lists kept showing pre-correction totals until an unrelated refetch.
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", "all-counts"] });
      // A correction adds or removes a training record and its hour bucket, so anything reading
      // compliance for that employee is stale. correct_completed_class_attendee runs
      // recalculate_compliance_core, same as complete_training_class above.
      queryClient.invalidateQueries({ queryKey: ["training_records"] });
      queryClient.invalidateQueries({ queryKey: ["training_hour_buckets"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}

export function useGenerateClassCheckinToken() {
  return useMutation({
    mutationFn: async (classId: string) => {
      const { data, error } = await supabase.rpc("generate_class_checkin_token", { p_class_id: classId });
      if (error) throw error;
      return data as string;
    },
  });
}

/**
 * Killing every outstanding check-in token for a class (BACKLOG.md G10).
 *
 * `generate_class_checkin_token` is wired -- the QR card rotates one every 30 seconds --
 * and `revoke_class_checkin_tokens` had no caller. A rotating token is not a substitute for
 * revocation: the current one stays valid until it rotates, and a QR photographed and shared
 * keeps working until then. This is the control for "that code is out, stop it now".
 */
export function useRevokeClassCheckinTokens() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { classId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("revoke_class_checkin_tokens" as never, {
        p_class_id: input.classId,
        p_reason: input.reason,
      } as never);
      if (error) throw error;
      return data as number | boolean;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["training_classes", input.classId] });
    },
  });
}

export function useCheckinViaToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.rpc("checkin_via_token", { p_token: token });
      if (error) throw error;
      return data as TrainingClassAttendee;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", data.class_id] });
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", "all-counts"] });
      invalidateTrainerDashboard(queryClient);
    },
  });
}

export function useCheckinViaKioskPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ classId, employeeId, pin }: { classId: string; employeeId: string; pin: string }) => {
      const { data, error } = await supabase.rpc("checkin_via_kiosk_pin", {
        p_class_id: classId, p_employee_id: employeeId, p_pin: pin,
      });
      if (error) throw error;
      return data as TrainingClassAttendee;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", data.class_id] });
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", "all-counts"] });
      invalidateTrainerDashboard(queryClient);
    },
  });
}

export function useSetEmployeeCheckinPin() {
  return useMutation({
    mutationFn: async ({ employeeId, pin }: { employeeId: string; pin: string }) => {
      const { error } = await supabase.rpc("set_employee_checkin_pin", { p_employee_id: employeeId, p_pin: pin });
      if (error) throw error;
    },
  });
}

export interface GenerateClassNoticePdfResult {
  url: string;
  path: string;
  expiresIn: number;
}

interface GenerateClassNoticePdfResponse extends GenerateClassNoticePdfResult {
  success?: boolean;
  error?: string;
}

// Always regenerates (no client-visible caching) -- a printed notice should reflect the latest
// class details/QR token each time an admin reprints it, matching the always-regenerate
// convention generate-incident-report-pdf already uses (as opposed to generate-certificate-pdf's
// cache-once behavior for an immutable issued certificate).
export function useGenerateClassNoticePdf() {
  return useMutation({
    mutationFn: async (classId: string): Promise<GenerateClassNoticePdfResult> => {
      const { data, error } = await supabase.functions.invoke<GenerateClassNoticePdfResponse>(
        "generate-class-notice-pdf",
        { body: { classId, baseUrl: window.location.origin } },
      );
      if (error) throw error;
      if (!data || data.success === false || !data.url) {
        throw new Error(data?.error ?? "Failed to generate meeting notice PDF");
      }
      return { url: data.url, path: data.path, expiresIn: data.expiresIn };
    },
  });
}

export interface SessionRegistrationResult {
  employeeId: string;
  success: boolean;
  registrationId?: string;
  status?: string;
  waitlistPosition?: number | null;
  error?: string;
}

/**
 * Enroll one employee into a capacity-aware training session. Re-running for an
 * already-registered employee returns the existing registration (idempotent).
 */
export function useRegisterForTrainingSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { classId: string; employeeId: string }) => {
      const { data, error } = await supabase.rpc("register_for_training_session", {
        p_class_id: input.classId,
        p_employee_id: input.employeeId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== "object") {
        throw new Error("Registration did not return a receipt.");
      }
      const record = row as {
        registration_id?: string;
        registration_status?: string;
        waitlist_position?: number | null;
      };
      return {
        employeeId: input.employeeId,
        success: true as const,
        registrationId: record.registration_id,
        status: record.registration_status,
        waitlistPosition: record.waitlist_position ?? null,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_classes"] });
      queryClient.invalidateQueries({ queryKey: ["training_session_registrations"] });
      invalidateTrainerDashboard(queryClient);
    },
  });
}

/**
 * Batch enroll a retraining cohort. Each employee is registered independently so one
 * capacity/permission failure does not roll back the rest; capacity/waitlist rules still
 * apply per call under the server advisory lock.
 */
export function useEnrollRetrainingCohort() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      classId: string;
      employeeIds: string[];
    }): Promise<SessionRegistrationResult[]> => {
      const results: SessionRegistrationResult[] = [];
      for (const employeeId of input.employeeIds) {
        try {
          const { data, error } = await supabase.rpc("register_for_training_session", {
            p_class_id: input.classId,
            p_employee_id: employeeId,
          });
          if (error) throw error;
          const row = Array.isArray(data) ? data[0] : data;
          const record = (row ?? {}) as {
            registration_id?: string;
            registration_status?: string;
            waitlist_position?: number | null;
          };
          results.push({
            employeeId,
            success: true,
            registrationId: record.registration_id,
            status: record.registration_status,
            waitlistPosition: record.waitlist_position ?? null,
          });
        } catch (error) {
          results.push({
            employeeId,
            success: false,
            error: error instanceof Error ? error.message : "Enrollment failed",
          });
        }
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_classes"] });
      queryClient.invalidateQueries({ queryKey: ["training_session_registrations"] });
      invalidateTrainerDashboard(queryClient);
    },
  });
}

// --- Session registrations: attendance and completion (BACKLOG.md G15.11, G15.12) ---------------
//
// `register_for_training_session` had a hook and no screen; `record_training_attendance` and
// `approve_training_session_completion` had neither. So the session model -- registrations with
// capacity and a waitlist, signed attendance evidence, and a trainer's approval that turns the
// session into training records -- existed end to end in the database and nowhere in the product.
//
// The two are a matched pair, which is why they are wired together: approval refuses unless every
// registration marked `attended` carries signed evidence, and recording that evidence is the only
// thing that produces it.

export interface TrainingSessionRegistration {
  id: string;
  employee_id: string;
  registration_status: string;
  waitlist_position: number | null;
  attendance_recorded_at: string | null;
  training_record_id: string | null;
}

export function useTrainingSessionRegistrations(classId: string | undefined) {
  return useQuery({
    queryKey: ["training_session_registrations", classId ?? null],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_session_registrations")
        .select("id,employee_id,registration_status,waitlist_position,attendance_recorded_at,training_record_id")
        .eq("class_id", classId!)
        .order("waitlist_position", { ascending: true, nullsFirst: true });
      if (error) throw error;
      return (data ?? []) as TrainingSessionRegistration[];
    },
  });
}

/** The three the server accepts. Only `attended` demands a signature. */
export const ATTENDANCE_STATUSES = [
  { value: "attended", label: "Attended" },
  { value: "partial", label: "Partial" },
  { value: "no_show", label: "Did not attend" },
] as const;

export function useRecordTrainingAttendance(classId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      registrationId: string;
      attendanceStatus: string;
      checkInAt: string;
      checkOutAt: string;
      attendeeSignatureSha256: string;
      recorderSignatureSha256: string;
      evidence?: Record<string, unknown>;
    }) => {
      const { error } = await supabase.rpc("record_training_attendance" as never, {
        p_registration_id: input.registrationId,
        p_attendance_status: input.attendanceStatus,
        p_check_in_at: input.checkInAt,
        p_check_out_at: input.checkOutAt,
        p_evidence: input.evidence ?? {},
        p_attendee_signature_sha256: input.attendeeSignatureSha256,
        p_recorder_signature_sha256: input.recorderSignatureSha256,
      } as never);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["training_session_registrations", classId ?? null] });
    },
  });
}

export function useApproveTrainingSessionCompletion(classId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { reason: string }) => {
      const { data, error } = await supabase.rpc("approve_training_session_completion" as never, {
        p_class_id: classId!,
        p_reason: input.reason,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["training_session_registrations", classId ?? null] });
      void queryClient.invalidateQueries({ queryKey: ["training_classes"] });
      void queryClient.invalidateQueries({ queryKey: ["training_records"] });
      // Approval inserts a `training_class_attendees` row per attended registration, so the roster
      // and the per-class counts both move. Every other mutation that touches attendees refreshes
      // these two; this one wrote the most rows of any of them and refreshed neither.
      void queryClient.invalidateQueries({ queryKey: ["training_class_attendees", classId ?? null] });
      void queryClient.invalidateQueries({ queryKey: ["training_class_attendees", "all-counts"] });
    },
  });
}
