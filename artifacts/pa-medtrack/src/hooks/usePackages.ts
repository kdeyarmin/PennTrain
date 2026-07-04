import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type Package = Tables<"packages">;
export type PackageInsert = TablesInsert<"packages">;
export type PackageUpdate = TablesUpdate<"packages">;

export function useListPackages() {
  return useQuery({
    queryKey: ["packages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("packages").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });
}

export function useGetPackage(id: string | null | undefined) {
  return useQuery({
    queryKey: ["packages", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("packages").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreatePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PackageInsert) => {
      const { data, error } = await supabase.from("packages").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packages"] }),
  });
}

export function useUpdatePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: PackageUpdate & { id: string }) => {
      const { data, error } = await supabase.from("packages").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packages"] }),
  });
}

export function useDeletePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("packages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packages"] }),
  });
}
