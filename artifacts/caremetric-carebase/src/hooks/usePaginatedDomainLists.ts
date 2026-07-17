import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { escapeOrValue, rangeFor } from "@/lib/utils";
import type { PaginatedResult, SortDirection } from "@/lib/dataTable";

export type DomainListName =
  | "residents" | "incidents" | "complaints" | "alerts" | "dhs_violations"
  | "inspection_items" | "training_documents" | "work_orders" | "employee_training_records";

type DomainListSource = DomainListName
  | "alert_list_rows" | "incident_list_rows" | "resident_roster_rows";

interface DomainListQueryResult {
  data: unknown[] | null;
  error: unknown;
  count: number | null;
}

interface DomainListQuery {
  select(columns: string, options: { count: "exact" }): DomainListQuery;
  eq(column: string, value: string | boolean): DomainListQuery;
  or(filters: string): DomainListQuery;
  order(column: string, options: { ascending: boolean }): DomainListQuery;
  range(from: number, to: number): PromiseLike<DomainListQueryResult>;
}

// Supabase's generated overloads intentionally separate tables and views. This
// hook selects either at runtime from a closed config, so use one small structural
// adapter instead of forcing every caller through the enormous table/view union.
const domainDatabase = supabase as unknown as {
  from(source: DomainListSource): DomainListQuery;
};

export interface DomainListFilters {
  facilityId?: string;
  organizationId?: string;
  residentId?: string;
  status?: string;
  severity?: string;
  itemKind?: string;
  isActive?: boolean;
  search?: string;
  sortField?: string;
  sortDir?: SortDirection;
  page: number;
  pageSize: number;
}

interface DomainListConfig {
  table: DomainListSource;
  defaultSort: string;
  defaultSortDir?: SortDirection;
  search: string[];
  facilityColumn?: string;
  residentColumn?: string;
  statusColumn?: string;
  severityColumn?: string;
  itemKindColumn?: string;
  activeColumn?: string;
}

const CONFIG: Record<DomainListName, DomainListConfig> = {
  residents: { table: "resident_roster_rows", defaultSort: "last_name", defaultSortDir: "asc", search: ["search_text"], facilityColumn: "facility_id", statusColumn: "status" },
  incidents: { table: "incident_list_rows", defaultSort: "occurred_at", search: ["search_text"], facilityColumn: "facility_id", residentColumn: "resident_id", statusColumn: "status", severityColumn: "severity" },
  complaints: { table: "complaints", defaultSort: "date_received", search: ["complaint_number", "category", "complainant_name"], facilityColumn: "facility_id", statusColumn: "status" },
  alerts: { table: "alert_list_rows", defaultSort: "created_at", search: ["title", "message", "alert_type"], facilityColumn: "facility_id", statusColumn: "status", severityColumn: "severity" },
  dhs_violations: { table: "dhs_violations", defaultSort: "inspection_date", search: ["citation_ref", "description"], facilityColumn: "facility_id", statusColumn: "status", severityColumn: "severity" },
  inspection_items: { table: "inspection_items", defaultSort: "next_due_date", defaultSortDir: "asc", search: ["label", "location_detail", "serial_number", "manufacturer", "model_number", "notes"], facilityColumn: "facility_id", statusColumn: "status", itemKindColumn: "item_kind", activeColumn: "is_active" },
  training_documents: { table: "training_documents", defaultSort: "created_at", search: ["file_name", "document_type"], facilityColumn: "facility_id" },
  work_orders: { table: "work_orders", defaultSort: "created_at", search: ["work_order_number", "problem_description", "location_detail"], facilityColumn: "facility_id", statusColumn: "status" },
  employee_training_records: { table: "employee_training_records", defaultSort: "completion_date", search: ["trainer_name", "training_provider", "certificate_number", "notes"], facilityColumn: "facility_id", statusColumn: "status" },
};

export function usePaginatedDomainList<T = Record<string, unknown>>(name: DomainListName, filters: DomainListFilters) {
  return useQuery({
    queryKey: [name, "paginated", filters],
    queryFn: async (): Promise<PaginatedResult<T>> => {
      const config = CONFIG[name];
      let query = domainDatabase.from(config.table).select("*", { count: "exact" });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId && config.facilityColumn) query = query.eq(config.facilityColumn, filters.facilityId);
      if (filters.residentId && config.residentColumn) query = query.eq(config.residentColumn, filters.residentId);
      if (filters.status && config.statusColumn) query = query.eq(config.statusColumn, filters.status);
      if (filters.severity && config.severityColumn) query = query.eq(config.severityColumn, filters.severity);
      if (filters.itemKind && config.itemKindColumn) query = query.eq(config.itemKindColumn, filters.itemKind);
      if (filters.isActive !== undefined && config.activeColumn) query = query.eq(config.activeColumn, filters.isActive);
      const search = filters.search?.trim();
      if (search) {
        const like = escapeOrValue(`%${search}%`);
        query = query.or(config.search.map((column) => `${column}.ilike.${like}`).join(","));
      }
      const sortField = filters.sortField || config.defaultSort;
      query = query.order(sortField, { ascending: (filters.sortDir ?? config.defaultSortDir ?? "desc") === "asc" });
      if (name === "alerts" && sortField === "severity_rank") {
        query = query.order("created_at", { ascending: false });
      }
      query = query.order("id", { ascending: true });
      const [from, to] = rangeFor(filters.page, filters.pageSize);
      const { data, error, count } = await query.range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as T[], count: count ?? 0 };
    },
    placeholderData: (previous) => previous,
    ...(name === "alerts" ? { staleTime: 0, refetchOnWindowFocus: true } : {}),
  });
}

export function usePaginatedViolations<T = Record<string, unknown>>(filters: DomainListFilters) {
  return useQuery({
    queryKey: ["dhs_violations", "paginated", filters],
    queryFn: async (): Promise<PaginatedResult<T>> => {
      let query = supabase
        .from("dhs_violations_search")
        .select("*", { count: "exact" });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.severity) query = query.eq("severity", filters.severity);
      const search = filters.search?.trim();
      if (search) {
        const like = escapeOrValue(`%${search}%`);
        query = query.or(
          ["citation_ref", "description", "citation_topic_title"]
            .map((column) => `${column}.ilike.${like}`)
            .join(","),
        );
      }
      query = query
        .order("inspection_date", { ascending: false })
        .order("id", { ascending: true });
      const [from, to] = rangeFor(filters.page, filters.pageSize);
      const { data, error, count } = await query.range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as T[], count: count ?? 0 };
    },
    placeholderData: (previous) => previous,
  });
}
