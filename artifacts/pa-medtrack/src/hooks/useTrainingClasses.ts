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
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["training_class_attendees", variables.class_id] }),
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
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["training_class_attendees", data.classId] }),
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
    },
  });
}
