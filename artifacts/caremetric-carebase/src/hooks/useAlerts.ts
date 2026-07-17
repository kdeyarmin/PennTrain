import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesUpdate } from "@/lib/database.types";
import { applyAlertCachePatch, type AlertCacheRow } from "@/lib/alertCache";

export type Alert = Tables<"alerts">;
type AlertListView = Tables<"alert_list_rows">;
export type AlertListRow = Alert & Pick<
  AlertListView,
  "severity_rank" | "linked_incident_id" | "linked_inspection_item_id" | "linked_resident_id"
>;
export type AlertUpdate = TablesUpdate<"alerts">;

const ALERTS_KEY = ["alerts"] as const;

type AlertQuerySnapshot = Array<[QueryKey, unknown]>;

function statusFilterFor(queryKey: QueryKey): string | undefined {
  const candidate = queryKey[1] === "paginated" ? queryKey[2] : queryKey[1];
  if (!candidate || typeof candidate !== "object" || !("status" in candidate)) return undefined;
  const status = (candidate as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}

function optimisticallyUpdateAlerts(
  queryClient: QueryClient,
  ids: ReadonlySet<string>,
  patch: AlertUpdate,
) {
  const previous = queryClient.getQueriesData({ queryKey: ALERTS_KEY });
  previous.forEach(([queryKey, value]) => {
    queryClient.setQueryData(
      queryKey,
      applyAlertCachePatch(value, ids, patch as Partial<AlertCacheRow>, statusFilterFor(queryKey)),
    );
  });
  return previous;
}

function restoreAlertQueries(queryClient: QueryClient, snapshot?: AlertQuerySnapshot) {
  snapshot?.forEach(([queryKey, value]) => queryClient.setQueryData(queryKey, value));
}

export interface ListAlertsFilters {
  facilityId?: string;
  status?: string;
  severity?: string;
  organizationId?: string;
}

export function useListAlerts(filters: ListAlertsFilters = {}) {
  return useQuery({
    queryKey: [...ALERTS_KEY, filters],
    queryFn: async () => {
      let query = supabase.from("alerts").select("*").order("created_at", { ascending: false });
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.severity) query = query.eq("severity", filters.severity);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    // Alerts are time-sensitive (e.g. another user just resolved one this tab hasn't seen yet) --
    // opt out of the app-wide 60s staleTime/refetchOnWindowFocus:false default in queryClient.ts
    // so this list refetches on every mount and every tab refocus, same as it always did.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * Realtime is the primary freshness path for the alert queue. The paginated query
 * still refetches on focus, so a dropped websocket never becomes a correctness gap.
 */
export function useAlertRealtime(organizationId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`alerts:${organizationId ?? "all-visible"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "alerts",
          ...(organizationId ? { filter: `organization_id=eq.${organizationId}` } : {}),
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId, queryClient]);
}

export function useUpdateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: AlertUpdate & { id: string }) => {
      const { data, error } = await supabase.from("alerts").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ id, ...payload }) => {
      await queryClient.cancelQueries({ queryKey: ALERTS_KEY });
      return { previous: optimisticallyUpdateAlerts(queryClient, new Set([id]), payload) };
    },
    onError: (_error, _variables, context) => restoreAlertQueries(queryClient, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALERTS_KEY }),
  });
}

export function useBulkUpdateAlerts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, ...payload }: AlertUpdate & { ids: string[] }) => {
      const { data, error } = await supabase.from("alerts").update(payload).in("id", ids).select();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ ids, ...payload }) => {
      await queryClient.cancelQueries({ queryKey: ALERTS_KEY });
      return { previous: optimisticallyUpdateAlerts(queryClient, new Set(ids), payload) };
    },
    onError: (_error, _variables, context) => restoreAlertQueries(queryClient, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALERTS_KEY }),
  });
}
