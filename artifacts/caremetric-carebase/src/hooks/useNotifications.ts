import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type Notification = Tables<"notifications">;

// Rows are populated exclusively by server-side triggers (training assignments,
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
    // Realtime is the primary freshness path; this is only a missed-event safety net.
    refetchInterval: 5 * 60_000,
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
    refetchInterval: 5 * 60_000,
  });
}

function invalidateNotifications(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
}

/** Keep the header badge and menu current without a one-minute polling delay. */
export function useNotificationRealtime(profileId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!profileId) return;
    const channel = supabase
      .channel(`notifications:${profileId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `profile_id=eq.${profileId}`,
        },
        () => invalidateNotifications(queryClient),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId, queryClient]);
}

type NotificationQuerySnapshot = Array<[QueryKey, unknown]>;

function restoreNotificationQueries(queryClient: QueryClient, snapshot?: NotificationQuerySnapshot) {
  snapshot?.forEach(([queryKey, value]) => queryClient.setQueryData(queryKey, value));
}

function optimisticallyReadOne(queryClient: QueryClient, id: string) {
  const readAt = new Date().toISOString();
  let wasUnread = false;
  queryClient.setQueriesData<Notification[]>(
    {
      queryKey: NOTIFICATIONS_KEY,
      predicate: (query) => typeof query.queryKey[1] === "number",
    },
    (rows) => rows?.map((row) => {
      if (row.id !== id) return row;
      if (!row.read_at) wasUnread = true;
      return { ...row, read_at: row.read_at ?? readAt };
    }),
  );
  if (wasUnread) {
    queryClient.setQueryData<number>([...NOTIFICATIONS_KEY, "unread-count"], (count) =>
      Math.max(0, (count ?? 0) - 1),
    );
  }
}

function optimisticallyReadAll(queryClient: QueryClient) {
  const readAt = new Date().toISOString();
  queryClient.setQueriesData<Notification[]>(
    {
      queryKey: NOTIFICATIONS_KEY,
      predicate: (query) => typeof query.queryKey[1] === "number",
    },
    (rows) => rows?.map((row) => ({ ...row, read_at: row.read_at ?? readAt })),
  );
  queryClient.setQueryData([...NOTIFICATIONS_KEY, "unread-count"], 0);
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = queryClient.getQueriesData({ queryKey: NOTIFICATIONS_KEY });
      optimisticallyReadOne(queryClient, id);
      return { previous };
    },
    onError: (_error, _id, context) => restoreNotificationQueries(queryClient, context?.previous),
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
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = queryClient.getQueriesData({ queryKey: NOTIFICATIONS_KEY });
      optimisticallyReadAll(queryClient);
      return { previous };
    },
    onError: (_error, _variables, context) => restoreNotificationQueries(queryClient, context?.previous),
    onSettled: () => invalidateNotifications(queryClient),
  });
}

export type NotificationDelivery = Tables<"notification_deliveries">;

// Read-only delivery log (email/SMS attempts for training_due_soon/training_expired
// notifications, plus escalations and the Monday digest) -- populated entirely server-side by
// the queue_notification_delivery trigger and the dispatch-notifications Edge Function; there is
// no client insert/update, only this list view.
export function useListNotificationDeliveries(limit = 20) {
  return useQuery({
    queryKey: ["notification_deliveries", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_deliveries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    },
  });
}
