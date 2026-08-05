/**
 * Whether an employee's access is actually active (BACKLOG.md G12.5).
 *
 * `is_employee_access_active` answers a question three tables jointly decide -- the employee's own
 * status, whether the linked profile is active, and whether an `employee_access_suspensions` window
 * covers the moment asked about. Nothing called it, from the client or from another function, and
 * nothing in the product surfaced `employee_access_suspensions` at all: the employee header badge
 * read `profile_id != null` and announced "Portal access active", which is true of a suspended
 * employee and of a deactivated profile.
 *
 * The `p_at` argument is the reason this is a function rather than a column. It answers "was access
 * active *then*", which is the question an investigation asks about the day of an incident, and no
 * column can answer after a suspension has been lifted.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useEmployeeAccessActive(employeeId: string | undefined, at?: string) {
  return useQuery({
    queryKey: ["employee-access-active", employeeId ?? null, at ?? "now"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_employee_access_active" as never, {
        p_employee_id: employeeId!,
        // Omitted, not null, when asking about now: the parameter defaults to now() server-side and
        // an explicit null would be passed straight through as null.
        ...(at ? { p_at: at } : {}),
      } as never);
      if (error) throw error;
      return data as unknown as boolean;
    },
    enabled: !!employeeId,
  });
}
