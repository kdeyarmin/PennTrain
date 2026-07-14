import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { escapeOrValue, rangeFor } from "@/lib/utils";
import type { PaginatedResult, SortDirection } from "@/lib/dataTable";

type DomainListName =
  | "residents" | "incidents" | "complaints" | "alerts" | "dhs_violations"
  | "inspection_items" | "training_documents" | "work_orders" | "employee_training_records";

export interface DomainListFilters {
  facilityId?: string;
  organizationId?: string;
  status?: string;
  severity?: string;
  search?: string;
  sortField?: string;
  sortDir?: SortDirection;
  page: number;
  pageSize: number;
}

const CONFIG: Record<DomainListName, { table: DomainListName; defaultSort: string; search: string[]; facilityColumn?: string; statusColumn?: string; severityColumn?: string }> = {
  residents: { table: "residents", defaultSort: "last_name", search: ["first_name", "last_name", "room_number"], facilityColumn: "facility_id", statusColumn: "status" },
  incidents: { table: "incidents", defaultSort: "occurred_at", search: ["incident_type", "location_detail", "resident_identifier"], facilityColumn: "facility_id", statusColumn: "status", severityColumn: "severity" },
  complaints: { table: "complaints", defaultSort: "date_received", search: ["complaint_number", "category", "complainant_name"], facilityColumn: "facility_id", statusColumn: "status" },
  alerts: { table: "alerts", defaultSort: "created_at", search: ["title", "message", "alert_type"], facilityColumn: "facility_id", statusColumn: "status", severityColumn: "severity" },
  dhs_violations: { table: "dhs_violations", defaultSort: "inspection_date", search: ["citation_ref", "description"], facilityColumn: "facility_id", statusColumn: "status", severityColumn: "severity" },
  inspection_items: { table: "inspection_items", defaultSort: "next_due_date", search: ["label", "location_detail", "serial_number"], facilityColumn: "facility_id", statusColumn: "status" },
  training_documents: { table: "training_documents", defaultSort: "created_at", search: ["file_name", "document_type"], facilityColumn: "facility_id" },
  work_orders: { table: "work_orders", defaultSort: "created_at", search: ["work_order_number", "problem_description", "location_detail"], facilityColumn: "facility_id", statusColumn: "status" },
  employee_training_records: { table: "employee_training_records", defaultSort: "completion_date", search: ["trainer_name", "training_provider", "certificate_number", "notes"], facilityColumn: "facility_id", statusColumn: "status" },
};

export function usePaginatedDomainList<T = Record<string, unknown>>(name: DomainListName, filters: DomainListFilters) {
  return useQuery({
    queryKey: [name, "paginated", filters],
    queryFn: async (): Promise<PaginatedResult<T>> => {
      const config = CONFIG[name];
      let query = supabase.from(config.table).select("*", { count: "exact" });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId && config.facilityColumn) query = query.eq(config.facilityColumn, filters.facilityId);
      if (filters.status && config.statusColumn) query = query.eq(config.statusColumn, filters.status);
      if (filters.severity && config.severityColumn) query = query.eq(config.severityColumn, filters.severity);
      const search = filters.search?.trim();
      if (search) {
        const like = escapeOrValue(`%${search}%`);
        query = query.or(config.search.map((column) => `${column}.ilike.${like}`).join(","));
      }
      query = query.order(filters.sortField || config.defaultSort, { ascending: (filters.sortDir ?? "desc") === "asc" });
      const [from, to] = rangeFor(filters.page, filters.pageSize);
      const { data, error, count } = await query.range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as T[], count: count ?? 0 };
    },
    placeholderData: (previous) => previous,
  });
}
