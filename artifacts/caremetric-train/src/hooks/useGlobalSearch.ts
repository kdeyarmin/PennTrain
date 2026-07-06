import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface GlobalSearchResults {
  organizations: { id: string; name: string }[];
  profiles: { id: string; first_name: string; last_name: string; email: string }[];
  employees: { id: string; first_name: string; last_name: string; organization_id: string }[];
}

const EMPTY_RESULTS: GlobalSearchResults = { organizations: [], profiles: [], employees: [] };

// PostgREST's or()/and() mini-language treats ',', '.', ':', '(', ')' as structural delimiters --
// left unescaped, a search term containing any of them (e.g. "Smith, Jane" or "Acme (East)") can
// split into extra conditions or otherwise change the filter's logical structure instead of
// erroring. Wrapping the value in double quotes and escaping embedded backslashes/quotes is
// PostgREST's own documented escape hatch for values inside or()/and().
function escapeOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// platform_admin-only, cross-tenant search -- RLS already grants platform_admin unrestricted
// SELECT on all three tables, so no org scoping is needed here the way it would be for any other
// role. Each category is capped at 5 results; this is a quick-jump tool; not a full search page.
export function useGlobalSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["global-search", trimmed],
    queryFn: async (): Promise<GlobalSearchResults> => {
      const like = `%${trimmed}%`;
      const likeOr = escapeOrValue(like);
      const [orgsRes, profilesRes, employeesRes] = await Promise.all([
        supabase.from("organizations").select("id, name").ilike("name", like).limit(5),
        supabase.from("profiles").select("id, first_name, last_name, email").or(`first_name.ilike.${likeOr},last_name.ilike.${likeOr},email.ilike.${likeOr}`).limit(5),
        supabase.from("employees").select("id, first_name, last_name, organization_id").or(`first_name.ilike.${likeOr},last_name.ilike.${likeOr}`).limit(5),
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
