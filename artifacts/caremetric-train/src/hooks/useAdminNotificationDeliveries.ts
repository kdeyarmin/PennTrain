import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type NotificationDelivery = Tables<"notification_deliveries">;

export interface ListNotificationDeliveriesFilters {
  organizationId?: string;
  status?: string;
  channel?: string;
  limit?: number;
}

// RLS on notification_deliveries grants platform_admin unrestricted cross-org
// SELECT (is_platform_admin() OR own-org read for org_admin/facility_manager),
// so this query needs no client-side org scoping -- platform_admin callers
// naturally get every organization's rows back.
export function useListNotificationDeliveries(filters: ListNotificationDeliveriesFilters = {}) {
  return useQuery({
    queryKey: ["notification_deliveries", filters],
    queryFn: async () => {
      let query = supabase
        .from("notification_deliveries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(filters.limit ?? 200);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.channel) query = query.eq("channel", filters.channel);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useRetryNotificationDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deliveryId: string) => {
      const { error } = await supabase.rpc("retry_notification_delivery", { p_delivery_id: deliveryId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification_deliveries"] }),
  });
}

// Simple id -> name lookup so the oversight page can show organization names
// instead of raw UUIDs (see ROADMAP: raw-UUID reports called out as a defect
// to avoid repeating).
export function useOrganizationNameMap() {
  return useQuery({
    queryKey: ["organizations", "name_map"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("id, name");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const org of data ?? []) map[org.id] = org.name;
      return map;
    },
  });
}
