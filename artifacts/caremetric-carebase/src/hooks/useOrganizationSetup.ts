import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { OrganizationSetupCounts } from "@/lib/organizationSetup";

async function countRows(table: "facilities" | "employees" | "residents" | "profiles", organizationId: string) {
  // head:true asks PostgREST for the count only -- no rows come back. The setup guide needs
  // "is there at least one", not the records themselves.
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Row counts behind the first-run setup guide. Four head-only count queries, so this stays
 * cheap enough to run on Home for every organization, including ones long past setup.
 */
export function useOrganizationSetup(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["organization_setup", organizationId],
    queryFn: async (): Promise<OrganizationSetupCounts> => {
      const [facilities, employees, residents, teamMembers] = await Promise.all([
        countRows("facilities", organizationId!),
        countRows("employees", organizationId!),
        countRows("residents", organizationId!),
        countRows("profiles", organizationId!),
      ]);
      return { facilities, employees, residents, teamMembers };
    },
    enabled: !!organizationId,
  });
}
