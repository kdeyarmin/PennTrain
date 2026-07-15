import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { Tables } from "@/lib/database.types";

export type NavigationPreference = Tables<"navigation_preferences">;
export type Announcement = Tables<"org_announcements">;
export type TrainingPassport = Tables<"training_passports">;
export type OrganizationExportJob = Tables<"organization_export_jobs">;

export type RecentPath = { path: string; label: string; visitedAt: string };
export type ProductChangelogEntry = {
  featureKey: string;
  title: string;
  summary: string;
  helpPath: string | null;
  releasedAt: string;
  isUnread: boolean;
};
export type ProductChangelog = {
  lastSeenAt: string | null;
  unreadCount: number;
  entries: ProductChangelogEntry[];
};
export type PublicTrainingPassport = {
  passportId: string;
  employeeName: string;
  generatedAt: string;
  certificateCount: number;
  totalCeHours: number;
  certificates: Array<{
    certificateId: string;
    credentialNumber: string;
    courseTitle: string;
    issuedAt: string;
    expiresAt: string | null;
    isValid: boolean;
    verificationPath: string;
    ceHours: number;
  }>;
};
export type ManagerDigestItem = { key: string; label: string; count: number; path: string };
export type ManagerDigestSnapshot = {
  id: string;
  organization_id: string;
  profile_id: string;
  week_started_on: string;
  items: ManagerDigestItem[];
  created_at: string;
};

function parseRecentPaths(value: unknown): RecentPath[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RecentPath => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return typeof value.path === "string" && typeof value.label === "string" && typeof value.visitedAt === "string";
  });
}

export function useNavigationWorkspace() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["navigation_preferences", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("navigation_preferences").select("*")
        .eq("profile_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 60_000,
  });
  const setFavorites = useMutation({
    mutationFn: async (favoritePaths: string[]) => {
      const { data, error } = await supabase.from("navigation_preferences").upsert({
        profile_id: user!.id,
        organization_id: user!.organizationId,
        favorite_paths: favoritePaths,
      }, { onConflict: "profile_id" }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.setQueryData(["navigation_preferences", user?.id], data),
  });
  const recordVisit = useMutation({
    mutationFn: async ({ path, label }: { path: string; label: string }) => {
      const { data, error } = await supabase.rpc("record_navigation_visit", { p_path: path, p_label: label });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.setQueryData(["navigation_preferences", user?.id], data),
  });
  return {
    ...query,
    favoritePaths: query.data?.favorite_paths ?? [],
    recentPaths: parseRecentPaths(query.data?.recent_paths),
    setFavorites,
    recordVisit,
  };
}

export function useAnnouncements() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["org_announcements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("org_announcements").select("*")
        .order("published_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });
  const publish = useMutation({
    mutationFn: async (input: {
      title: string;
      body: string;
      audienceRoles: string[];
      audienceFacilityIds: string[];
      expiresAt: string | null;
    }) => {
      const { data, error } = await supabase.rpc("publish_org_announcement", {
        p_title: input.title,
        p_body: input.body,
        p_audience_roles: input.audienceRoles,
        p_audience_facility_ids: input.audienceFacilityIds,
        p_expires_at: input.expiresAt ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org_announcements"] }),
  });
  const markSeen = useMutation({
    mutationFn: async (announcementId: string) => {
      const { data, error } = await supabase.rpc("mark_org_announcement_seen", {
        p_announcement_id: announcementId,
      });
      if (error) throw error;
      return data;
    },
  });
  return { ...query, publish, markSeen };
}

export function useMyTrainingPassport() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["training_passport", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_passports").select("*")
        .eq("profile_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  const enable = useMutation({
    mutationFn: async (includeExpired: boolean) => {
      const { data, error } = await supabase.rpc("enable_my_training_passport", {
        p_include_expired: includeExpired,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_passport", user?.id] }),
  });
  const revoke = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("revoke_my_training_passport");
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_passport", user?.id] }),
  });
  return { ...query, enable, revoke };
}

export function usePublicTrainingPassport(slug: string | undefined) {
  return useQuery({
    queryKey: ["public_training_passport", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_training_passport", { p_slug: slug! });
      if (error) throw error;
      return data as PublicTrainingPassport | null;
    },
    enabled: !!slug,
  });
}

export function useOrganizationExports(organizationId: string | null | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["organization_export_jobs", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("organization_export_jobs").select("*")
        .eq("organization_id", organizationId!).order("requested_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
    refetchInterval: (state) => state.state.data?.some((job) => ["pending", "processing"].includes(job.status)) ? 5_000 : false,
  });
  const request = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("request_organization_export");
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization_export_jobs", organizationId] }),
  });
  const download = useMutation({
    mutationFn: async (job: OrganizationExportJob) => {
      if (!job.storage_bucket || !job.storage_path) throw new Error("Export archive is not ready");
      const { data, error } = await supabase.storage.from(job.storage_bucket).createSignedUrl(job.storage_path, 300);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  return { ...query, request, download };
}

export function useProductChangelog() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["product_changelog"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_product_changelog", { p_limit: 50 });
      if (error) throw error;
      return data as ProductChangelog;
    },
    staleTime: 5 * 60_000,
  });
  const markSeen = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("mark_product_changelog_seen");
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product_changelog"] }),
  });
  return { ...query, markSeen };
}

export function useManagerDigest(digestId: string | undefined) {
  return useQuery({
    queryKey: ["manager_digest_snapshot", digestId],
    queryFn: async () => {
      const { data, error } = await supabase.from("manager_digest_snapshots").select("*")
        .eq("id", digestId!).single();
      if (error) throw error;
      return data as ManagerDigestSnapshot;
    },
    enabled: !!digestId,
  });
}

export function useSandboxActions() {
  const queryClient = useQueryClient();
  const ensure = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("ensure_organization_sandbox");
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["facilities"] }),
  });
  const reset = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("reset_organization_sandbox");
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["facilities"] }),
  });
  return { ensure, reset };
}
