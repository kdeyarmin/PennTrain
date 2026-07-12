import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Role } from "@/lib/auth";
import { escapeOrValue } from "@/lib/utils";

export interface GlobalSearchResults {
  organizations: { id: string; name: string }[];
  profiles: { id: string; first_name: string; last_name: string; email: string }[];
  employees: { id: string; first_name: string; last_name: string; organization_id: string }[];
  residents: { id: string; first_name: string; last_name: string; facility_id: string }[];
}

const EMPTY_RESULTS: GlobalSearchResults = { organizations: [], profiles: [], employees: [], residents: [] };

// RLS is the real scoping boundary here, same as every other query in the app -- org_admin/
// facility_manager/trainer/auditor only ever see their own org's rows on these tables regardless
// of what this hook asks for, so no client-side org filter is needed. Which tables get queried
// per role instead mirrors which routes that role actually has (see App.tsx's ORG_ROLES/
// ORG_MANAGE_ROLES/RESIDENT_ROLES) so results always link somewhere the current user can open.
function tablesForRole(role: Role | undefined) {
  return {
    organizations: role === "platform_admin",
    profiles: role === "platform_admin" || role === "org_admin" || role === "facility_manager",
    employees: role !== "employee",
    residents: role === "org_admin" || role === "facility_manager" || role === "auditor",
  };
}

export function useGlobalSearch(query: string, role: Role | undefined) {
  const trimmed = query.trim();
  const include = tablesForRole(role);
  return useQuery({
    queryKey: ["global-search", trimmed, role],
    queryFn: async (): Promise<GlobalSearchResults> => {
      const like = `%${trimmed}%`;
      const likeOr = escapeOrValue(like);
      const [orgsRes, profilesRes, employeesRes, residentsRes] = await Promise.all([
        include.organizations
          ? supabase.from("organizations").select("id, name").ilike("name", like).limit(5)
          : Promise.resolve({ data: [], error: null }),
        include.profiles
          ? supabase.from("profiles").select("id, first_name, last_name, email").or(`first_name.ilike.${likeOr},last_name.ilike.${likeOr},email.ilike.${likeOr}`).limit(5)
          : Promise.resolve({ data: [], error: null }),
        include.employees
          ? supabase.from("employees").select("id, first_name, last_name, organization_id").or(`first_name.ilike.${likeOr},last_name.ilike.${likeOr}`).limit(5)
          : Promise.resolve({ data: [], error: null }),
        include.residents
          ? supabase.from("residents").select("id, first_name, last_name, facility_id").or(`first_name.ilike.${likeOr},last_name.ilike.${likeOr}`).limit(5)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (orgsRes.error) throw orgsRes.error;
      if (profilesRes.error) throw profilesRes.error;
      if (employeesRes.error) throw employeesRes.error;
      if (residentsRes.error) throw residentsRes.error;
      return {
        organizations: orgsRes.data ?? [],
        profiles: profilesRes.data ?? [],
        employees: employeesRes.data ?? [],
        residents: residentsRes.data ?? [],
      };
    },
    enabled: trimmed.length >= 2 && !!role,
    placeholderData: EMPTY_RESULTS,
  });
}
