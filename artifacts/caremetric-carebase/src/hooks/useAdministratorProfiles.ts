import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type AdministratorProfile = Tables<"administrator_profiles">;
export type AdministratorProfileInsert = TablesInsert<"administrator_profiles">;
export type AdministratorCeEntry = Tables<"administrator_ce_entries">;
export type AdministratorCeEntryInsert = TablesInsert<"administrator_ce_entries">;

export function useListAdministratorProfiles(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["administrator_profiles", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("administrator_profiles")
        .select("*")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });
}

export function useGetAdministratorProfileByProfileId(profileId: string | undefined) {
  return useQuery({
    queryKey: ["administrator_profiles", "by-profile", profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("administrator_profiles")
        .select("*")
        .eq("profile_id", profileId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!profileId,
  });
}

// One row per administrator -- upsert-on-profile_id so the same form handles first-time create
// and later edits without the caller needing to know which case it is.
export function useUpsertAdministratorProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AdministratorProfileInsert) => {
      const { data, error } = await supabase
        .from("administrator_profiles")
        .upsert(payload, { onConflict: "profile_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["administrator_profiles"] }),
  });
}

export function useListAdministratorCeEntries(administratorProfileId: string | undefined) {
  return useQuery({
    queryKey: ["administrator_profiles", "ce_entries", administratorProfileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("administrator_ce_entries")
        .select("*")
        .eq("administrator_profile_id", administratorProfileId!)
        .order("completed_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!administratorProfileId,
  });
}

export function useAddAdministratorCeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AdministratorCeEntryInsert) => {
      // organization_id is re-stamped server-side (stamp_org_from_administrator_profile) from
      // administrator_profile_id -- the value passed here is just a placeholder satisfying the
      // not-null insert type, same convention as employee_credentials/policy_attestations.
      const { data, error } = await supabase
        .from("administrator_ce_entries")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["administrator_profiles", "ce_entries", data.administrator_profile_id] }),
  });
}

export function useDeleteAdministratorCeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, administratorProfileId }: { id: string; administratorProfileId: string }) => {
      const { error } = await supabase.from("administrator_ce_entries").delete().eq("id", id);
      if (error) throw error;
      return { administratorProfileId };
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["administrator_profiles", "ce_entries", data.administratorProfileId] }),
  });
}

export function useAdministratorDocumentSignedUrl() {
  return useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.storage.from("administrator-documents").createSignedUrl(path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function useUploadAdministratorDocument() {
  return useMutation({
    mutationFn: async ({ file, organizationId, profileId }: { file: File; organizationId: string; profileId: string }) => {
      const path = `${organizationId}/${profileId}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("administrator-documents").upload(path, file);
      if (error) throw error;
      return path;
    },
  });
}
