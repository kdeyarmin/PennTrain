import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useAuditLogs.ts
=======
import { rangeFor } from "@/lib/utils";
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useAuditLogs.ts

export type AuditLog = Tables<"audit_logs">;

export interface ListAuditLogsFilters {
  entityType?: string;
<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useAuditLogs.ts
  limit?: number;
}

=======
  entityId?: string;
  organizationId?: string;
  limit?: number;
}

// Capped plain-array fetch -- used for the small, single-entity activity feeds embedded in other
// pages (e.g. EmployeeDetail's "Recent Activity" card, entityId-scoped) that just want a bounded
// list of rows, not a counted/paginated result. For the full Audit Log page itself, which needs a
// real total count and page navigation over a table with no practical row cap, see
// useListAuditLogsPaginated below.
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useAuditLogs.ts
export function useListAuditLogs(filters: ListAuditLogsFilters = {}) {
  return useQuery({
    queryKey: ["audit_logs", filters],
    queryFn: async () => {
      let query = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(filters.limit ?? 200);
      if (filters.entityType) query = query.eq("entity_type", filters.entityType);
<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useAuditLogs.ts
=======
      if (filters.entityId) query = query.eq("entity_id", filters.entityId);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useAuditLogs.ts
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}
<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useAuditLogs.ts
=======

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
      let query = supabase.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false });
      if (filters.entityType) query = query.eq("entity_type", filters.entityType);
      if (filters.entityId) query = query.eq("entity_id", filters.entityId);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      // .lte() on the bare date would exclude same-day rows after midnight, since created_at is a
      // full timestamp -- anchor the "To" bound at the end of that day instead.
      if (filters.dateFrom) query = query.gte("created_at", `${filters.dateFrom}T00:00:00.000Z`);
      if (filters.dateTo) query = query.lte("created_at", `${filters.dateTo}T23:59:59.999Z`);
      const [from, to] = rangeFor(filters.page, filters.pageSize);
      query = query.range(from, to);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
    placeholderData: (previousData) => previousData,
  });
}
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useAuditLogs.ts
