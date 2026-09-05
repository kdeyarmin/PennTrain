import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface GuestAccessHealthRow {
  surface: string;
  failed_lookups: number;
  distinct_callers: number;
  worst_caller_failures: number;
  last_failure_at: string;
}

/**
 * Guest tokens that resolved to nothing, grouped by surface (BACKLOG.md I16).
 *
 * Platform-admin only, enforced inside `get_guest_access_health` rather than here. The underlying
 * rows live in `app_private.guest_token_failures`, which the anonymous surface being watched
 * cannot read.
 */
export function useGuestAccessHealth(hours = 24) {
  return useQuery({
    queryKey: ["guest_access_health", hours],
    queryFn: async (): Promise<GuestAccessHealthRow[]> => {
      const { data, error } = await supabase.rpc("get_guest_access_health", { p_hours: hours });
      if (error) throw error;
      return (data ?? []) as GuestAccessHealthRow[];
    },
  });
}
