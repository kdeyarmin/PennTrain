import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface GlobalSearchResults {
  organizations: { id: string; name: string }[];
  profiles: { id: string; first_name: string; last_name: string; email: string }[];
  employees: { id: string; first_name: string; last_name: string; organization_id: string }[];
}

const EMPTY_RESULTS: GlobalSearchResults = { organizations: [], profiles: [], employees: [] };

// platform_admin-only, cross-tenant search -- RLS already grants platform_admin unrestricted
// SELECT on all three tables, so no org scoping is needed here the way it would be for any other
// role. Each category is capped at 5 results; this is a quick-jump tool; not a full search page.
export function useGlobalSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["global-search", trimmed],
    queryFn: async (): Promise<GlobalSearchResults> => {
      const like = `%${trimmed}%`;
      const [orgsRes, profilesRes, employeesRes] = await Promise.all([
        supabase.from("organizations").select("id, name").ilike("name", like).limit(5),
        supabase.from("profiles").select("id, first_name, last_name, email").or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`).limit(5),
        supabase.from("employees").select("id, first_name, last_name, organization_id").or(`first_name.ilike.${like},last_name.ilike.${like}`).limit(5),
      ]);
      if (orgsRes.error) throw orgsRes.error;
      if (profilesRes.error) throw profilesRes.error;
      if (employeesRes.error) throw employeesRes.error;
      return {
        organizations: orgsRes.data ?? [],
        profiles: profilesRes.data ?? [],
        employees: employeesRes.data ?? [],
      };
    },
    enabled: trimmed.length >= 2,
    placeholderData: EMPTY_RESULTS,
  });
}
