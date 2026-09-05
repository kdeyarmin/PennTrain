import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface NotificationReachRow {
  organization_id: string;
  organization_name: string;
  active_employees: number;
  reachable_employees: number;
  unreachable_employees: number;
}

/**
 * How many active employees the product can actually send anything to.
 *
 * Every notification path resolves its recipient through `profiles` -- the enqueue functions read
 * `profiles.email` / `profiles.phone`, and the reminder jobs join on `employees.profile_id is not
 * null`. The import worker writes `employees.phone`, which no delivery path reads. So a facility
 * that imports forty aides and invites none of them gets zero reminders, zero deliveries and zero
 * failures: the system does exactly what it says and no screen says so. This is that number.
 *
 * Platform admins get every organization; everyone else gets their own. See BACKLOG.md I21.
 */
export function useNotificationReach() {
  return useQuery({
    queryKey: ["notification_reach"],
    queryFn: async (): Promise<NotificationReachRow[]> => {
      const { data, error } = await supabase.rpc("get_notification_reach");
      if (error) throw error;
      return (data ?? []) as NotificationReachRow[];
    },
  });
}
