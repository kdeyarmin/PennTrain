import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { Tables } from "@/lib/database.types";

export type Notification = Tables<"notifications">;

// Rows are populated exclusively by server-side triggers (training assignments,
// graded quizzes, issued certificates, competency evaluations, training due/
// expired alerts) -- there is no client insert. Marking read goes through the
// two RPCs below rather than a direct table UPDATE; see the migration for why.

const NOTIFICATIONS_KEY = ["notifications"] as const;

export function useListNotifications(limit = 30) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, user?.id ?? null, user?.organizationId ?? null, user?.role ?? null, limit],
    enabled: !!user?.id,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("profile_id", user!.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit)
        .abortSignal(signal);
      if (error) throw error;
      return data;
    },
    // Realtime is the primary freshness path; this is only a missed-event safety net.
    refetchInterval: 5 * 60_000,
  });
}

export function useUnreadNotificationCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, user?.id ?? null, user?.organizationId ?? null, user?.role ?? null, "unread-count"],
    enabled: !!user?.id,
    queryFn: async ({ signal }) => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", user!.id)
        .is("read_at", null)
        .abortSignal(signal);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 5 * 60_000,
  });
}

// Confirm read state through the server. Rolling back a whole optimistic snapshot
// can replace newer arrivals or another account's cache after a delayed failure.
function invalidateNotifications(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
      if (error) throw error;
    },
    onSettled: () => invalidateNotifications(queryClient),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("mark_all_notifications_read");
      if (error) throw error;
    },
    onSettled: () => invalidateNotifications(queryClient),
  });
}

export type NotificationDelivery = Tables<"notification_deliveries">;

// Read-only delivery log (email/SMS attempts for training_due_soon/training_expired
// notifications, plus escalations and the Monday digest) -- populated entirely server-side by
// the queue_notification_delivery trigger and the dispatch-notifications Edge Function; there is
// no client insert/update, only this list view.
export function useListNotificationDeliveries(limit = 20) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notification_deliveries", user?.id ?? null, user?.organizationId ?? null, user?.role ?? null, limit],
    enabled: !!user?.id,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from("notification_deliveries")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit)
        .abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
}
