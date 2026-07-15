import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Role } from "@/lib/auth";

export interface WorkspaceSearchItem {
  kind: string;
  id: string;
  label: string;
  subtitle: string | null;
  status: string | null;
  facilityId: string | null;
  facilityName: string | null;
  route: string;
}

export interface GlobalSearchResults {
  items: WorkspaceSearchItem[];
  organizations: { id: string; name: string }[];
  profiles: { id: string; first_name: string; last_name: string; email: string }[];
  employees: { id: string; first_name: string; last_name: string; organization_id: string }[];
  residents: { id: string; first_name: string; last_name: string; facility_id: string }[];
  courses: { assignmentId: string; title: string }[];
}

const EMPTY_RESULTS: GlobalSearchResults = { items: [], organizations: [], profiles: [], employees: [], residents: [], courses: [] };

export function useGlobalSearch(query: string, role: Role | undefined) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["global-search", trimmed, role],
    queryFn: async (): Promise<GlobalSearchResults> => {
      const { data, error } = await supabase.rpc("search_workspace", { p_query: trimmed });
      if (error) throw error;
      const result = (data ?? {}) as Partial<GlobalSearchResults>;
      return {
        items: Array.isArray(result.items) ? result.items : [],
        organizations: Array.isArray(result.organizations) ? result.organizations : [],
        profiles: Array.isArray(result.profiles) ? result.profiles : [],
        employees: Array.isArray(result.employees) ? result.employees : [],
        residents: Array.isArray(result.residents) ? result.residents : [],
        courses: Array.isArray(result.courses) ? result.courses : [],
      };
    },
    enabled: trimmed.length >= 2 && !!role,
    placeholderData: (previous) => previous ?? EMPTY_RESULTS,
    staleTime: 15_000,
  });
}
