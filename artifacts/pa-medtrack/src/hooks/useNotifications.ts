import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type Notification = Tables<"notifications">;

// Rows are populated exclusively by server-side triggers (course assignments,
// graded quizzes, issued certificates, competency evaluations, training due/
// expired alerts) -- there is no client insert. Marking read goes through the
// two RPCs below rather than a direct table UPDATE; see the migration for why.

const NOTIFICATIONS_KEY = ["notifications"] as const;

export function useListNotifications(limit = 30) {
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, "unread-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
}

function invalidateNotifications(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => invalidateNotifications(queryClient),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("mark_all_notifications_read");
      if (error) throw error;
    },
    onSuccess: () => invalidateNotifications(queryClient),
  });
}
