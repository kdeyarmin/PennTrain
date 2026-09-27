import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type EmployeeQualification = Tables<"employee_qualifications"> & {
  definition: { name: string; qualification_key: string } | null;
  version: { version_number: number } | null;
  facility: { name: string } | null;
};

export function useEmployeeQualifications(employeeId: string, organizationId: string) {
  return useQuery({
    // The existing command invalidates this prefix after success; the form refreshes failures.
    queryKey: ["qualified-workforce", "qualifications", organizationId, employeeId],
    enabled: !!employeeId && !!organizationId,
    queryFn: async ({ signal }): Promise<EmployeeQualification[]> => {
      if (!employeeId || !organizationId) return [];
      const rows: EmployeeQualification[] = [];
      for (;;) {
        const { data, error } = await supabase.from("employee_qualifications")
          .select("*, definition:certification_definitions(name, qualification_key), version:certification_definition_versions(version_number), facility:facilities(name)")
          .eq("organization_id", organizationId).eq("employee_id", employeeId)
          .order("issued_at", { ascending: false }).order("id")
          .range(rows.length, rows.length + 999).abortSignal(signal);
        if (error) throw error;
        if (!data?.length) return rows;
        rows.push(...data);
      }
    },
  });
}
