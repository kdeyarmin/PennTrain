import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Role } from "@/lib/auth";
import { escapeOrValue } from "@/lib/utils";

export interface GlobalSearchResults {
  organizations: { id: string; name: string }[];
  profiles: { id: string; first_name: string; last_name: string; email: string }[];
  employees: { id: string; first_name: string; last_name: string; organization_id: string }[];
  residents: { id: string; first_name: string; last_name: string; facility_id: string }[];
  courses: { assignmentId: string; title: string }[];
}

const EMPTY_RESULTS: GlobalSearchResults = { organizations: [], profiles: [], employees: [], residents: [], courses: [] };

// RLS is the real scoping boundary here, same as every other query in the app -- org_admin/
// facility_manager/trainer/auditor only ever see their own org's rows on these tables regardless
// of what this hook asks for, so no client-side org filter is needed. Which tables get queried
// per role instead mirrors which routes that role actually has (see App.tsx's ORG_ROLES/
// ORG_MANAGE_ROLES/RESIDENT_ROLES) so results always link somewhere the current user can open.
// Employees get their own scoped surface: RLS limits course_assignments to their own rows, so
// searching those by course title lets them jump straight to a specific assigned course.
function tablesForRole(role: Role | undefined) {
  return {
    organizations: role === "platform_admin",
    profiles: role === "platform_admin" || role === "org_admin" || role === "facility_manager",
    employees: role !== "employee",
    residents: role === "org_admin" || role === "facility_manager" || role === "auditor",
    courses: role === "employee",
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
      const [orgsRes, profilesRes, employeesRes, residentsRes, coursesRes] = await Promise.all([
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
        include.courses
          ? supabase.from("course_assignments").select("id, courses!inner(id, title)").ilike("courses.title", like).limit(5)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (orgsRes.error) throw orgsRes.error;
      if (profilesRes.error) throw profilesRes.error;
      if (employeesRes.error) throw employeesRes.error;
      if (residentsRes.error) throw residentsRes.error;
      if (coursesRes.error) throw coursesRes.error;
      return {
        organizations: orgsRes.data ?? [],
        profiles: profilesRes.data ?? [],
        employees: employeesRes.data ?? [],
        residents: residentsRes.data ?? [],
        courses: (coursesRes.data ?? []).flatMap((row: { id: string; courses: { title: string } | { title: string }[] | null }) => {
          const course = Array.isArray(row.courses) ? row.courses[0] : row.courses;
          return course ? [{ assignmentId: row.id, title: course.title }] : [];
        }),
      };
    },
    enabled: trimmed.length >= 2 && !!role,
    placeholderData: EMPTY_RESULTS,
  });
}
