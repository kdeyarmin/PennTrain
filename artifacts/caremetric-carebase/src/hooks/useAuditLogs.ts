import { useQuery } from "@tanstack/react-query";
import { facilityDayBounds } from "@/lib/dateUtils";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import { rangeFor } from "@/lib/utils";

export type AuditLog = Tables<"audit_logs">;

export interface ListAuditLogsFilters {
  entityType?: string;
  entityId?: string;
  organizationId?: string;
  limit?: number;
}

// Capped plain-array fetch -- used for the small, single-entity activity feeds embedded in other
// pages (e.g. EmployeeDetail's "Recent Activity" card, entityId-scoped) that just want a bounded
// list of rows, not a counted/paginated result. For the full Audit Log page itself, which needs a
// real total count and page navigation over a table with no practical row cap, see
// useListAuditLogsPaginated below.
export function useListAuditLogs(filters: ListAuditLogsFilters = {}) {
  return useQuery({
    queryKey: ["audit_logs", filters],
    queryFn: async () => {
      let query = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(filters.limit ?? 200);
      if (filters.entityType) query = query.eq("entity_type", filters.entityType);
      if (filters.entityId) query = query.eq("entity_id", filters.entityId);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export interface ListAuditLogsPaginatedFilters {
  entityType?: string;
  entityId?: string;
  organizationId?: string;
  /** Inclusive lower bound on created_at, as a "YYYY-MM-DD" date (start of that day, UTC). */
  dateFrom?: string;
  /** Inclusive upper bound on created_at, as a "YYYY-MM-DD" date (end of that day, UTC). */
  dateTo?: string;
  page: number;
  pageSize: number;
}

// Server-side paginated/filtered variant for the Audit Log page itself -- a separate hook (rather
// than an overload of useListAuditLogs above) so EmployeeDetail's embedded feed keeps the exact
// same plain-array query shape/cache key it always had. Mirrors useListEmployeesPaginated in
// useEmployees.ts.
export function useListAuditLogsPaginated(filters: ListAuditLogsPaginatedFilters) {
  return useQuery({
    queryKey: ["audit_logs", "paginated", filters],
    queryFn: async () => {
      // The `id` tie-break makes the sort a total order, which OFFSET paging needs: one RPC or
      // trigger can write many audit rows inside a single statement, all sharing `created_at`, and
      // a page boundary inside that run would otherwise let Postgres resolve the two page requests
      // differently -- repeating entries on one page and dropping them from the next. An audit log
      // that omits entries when read page-by-page is the one list that must never do so.
      let query = supabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (filters.entityType) query = query.eq("entity_type", filters.entityType);
      if (filters.entityId) query = query.eq("entity_id", filters.entityId);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      // Date inputs are facility calendar days. Bound them with Pennsylvania midnight instants —
      // UTC `T00:00Z` / `T23:59Z` cut the PA evening off the "To" day.
      if (filters.dateFrom) query = query.gte("created_at", facilityDayBounds(filters.dateFrom).from);
      if (filters.dateTo) query = query.lt("created_at", facilityDayBounds(filters.dateTo).through);
      const [from, to] = rangeFor(filters.page, filters.pageSize);
      query = query.range(from, to);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
    placeholderData: (previousData) => previousData,
  });
}
