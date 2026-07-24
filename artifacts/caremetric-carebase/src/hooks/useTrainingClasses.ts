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
}

export function useListTrainingClasses(filters: ListTrainingClassesFilters = {}) {
  return useQuery({
    queryKey: ["training_classes", filters],
    queryFn: async () => {
      let query = supabase.from("training_classes").select("*").order("class_date", { ascending: false });
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.trainerProfileId) query = query.eq("trainer_profile_id", filters.trainerProfileId);
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
      const { data, error } = await supabase.from("training_class_attendees").select("class_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data) counts[row.class_id] = (counts[row.class_id] ?? 0) + 1;
      return counts;
    },
  });
}

export function useCreateTrainingClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TrainingClassInsert) => {
      const { data, error } = await supabase.from("training_classes").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_classes"] }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_classes"] }),
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

export function useGenerateClassCheckinToken() {
  return useMutation({
    mutationFn: async (classId: string) => {
      const { data, error } = await supabase.rpc("generate_class_checkin_token", { p_class_id: classId });
      if (error) throw error;
      return data as string;
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
