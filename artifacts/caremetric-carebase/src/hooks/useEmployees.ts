import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";
import { containsFilterValue, rangeFor } from "@/lib/utils";
import { TRAINING_MATRIX_QUERY_KEY } from "@/hooks/useTrainingMatrix";

export type Employee = Tables<"employees">;
export type EmployeeInsert = TablesInsert<"employees">;
export type EmployeeUpdate = TablesUpdate<"employees">;

export interface ListEmployeesFilters {
  facilityId?: string;
  status?: string;
  /**
   * Several statuses at once, for callers whose set of acceptable statuses depends on what the
   * server will accept -- the lifecycle wizard's picker, whose eligible statuses differ per
   * transition (rehire wants `terminated`, return wants `on_leave`, transfer takes either of
   * `active`/`on_leave`). Applied with `.in`, and ignored when empty so it can never silently
   * widen to "every status"; `status` still applies on top when both are given.
   */
  statuses?: readonly string[];
  organizationId?: string;
  /** When set, restrict to staff who do / do not administer medications. */
  administersMedications?: boolean;
  /**
   * When set, restrict to staff flagged as trainers. Lets a trainer picker fetch just the
   * trainers instead of the whole roster to filter it down in the browser.
   */
  trainerStatus?: boolean;
}

// Unbounded by design -- used for dropdowns/rosters/matrices elsewhere in the app that need the
// complete filtered set, not a page of it. For the paginated roster table, see
// useListEmployeesPaginated below.
//
// `options.enabled` matters for callers that intend to scope by organizationId but don't have one
// yet (e.g. EmployeeDetail.tsx's trainer picker, scoped to the viewed employee's org, before that
// employee record has resolved) -- every filter field here is applied only `if` truthy, so an
// absent organizationId doesn't scope to "nothing," it scopes to "no filter at all," firing an
// unscoped all-tenant fetch first and a correctly-scoped one right behind it. Passing
// `enabled: false` until the real value is known avoids that wasted (and, for platform_admin,
// cross-org) first fetch. Mirrors usePolicyAttestations.ts's useListPolicyAttestations. Defaults
// to `undefined`, which react-query treats as "always enabled," so every existing caller that
// doesn't pass `options` is unaffected.
export function useListEmployees(filters: ListEmployeesFilters = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["employees", filters],
    queryFn: async () => {
      let query = supabase.from("employees").select("*").order("last_name");
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.statuses?.length) query = query.in("status", [...filters.statuses]);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.administersMedications !== undefined) {
        query = query.eq("administers_medications", filters.administersMedications);
      }
      if (filters.trainerStatus !== undefined) {
        query = query.eq("trainer_status", filters.trainerStatus);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: options.enabled,
  });
}

// Targeted lookup by primary key for pages that only need labels / rows for a known, small set of
// employee ids (kiosk cross-facility attendees, credential-renewal inbox, audit-entity resolution).
// Prefer this over useListEmployees({}) whenever the caller already has the ids -- it keeps the
// payload proportional to the work on screen instead of the whole tenant roster.
export function useListEmployeesByIds(ids: string[]) {
  // Sort for a stable query key so reordering the same set does not refetch.
  const sortedIds = [...ids].filter(Boolean).sort();
  return useQuery({
    queryKey: ["employees", "by-ids", sortedIds],
    queryFn: async () => {
      if (sortedIds.length === 0) return [] as Employee[];
      // PostgREST .in() is fine for the small batches these call sites produce (typically <50).
      const { data, error } = await supabase
        .from("employees")
        .select("*")
        .in("id", sortedIds)
        .order("last_name");
      if (error) throw error;
      return data;
    },
    enabled: sortedIds.length > 0,
  });
}

export type EmployeeSortField = "lastName" | "status" | "jobTitle" | "hireDate";

const SORT_COLUMNS: Record<EmployeeSortField, string> = {
  lastName: "last_name",
  status: "status",
  jobTitle: "job_title",
  hireDate: "hire_date",
};

export interface ListEmployeesPaginatedFilters extends ListEmployeesFilters {
  search?: string;
  sortField?: EmployeeSortField;
  sortDir?: "asc" | "desc";
  page: number;
  pageSize: number;
}

// Server-side search/sort/pagination for the Employees roster page -- a separate hook (rather
// than an overload of useListEmployees above) so the many other pages that want the full
// filtered list untouched keep the exact same query shape/cache key they always had.
export function useListEmployeesPaginated(filters: ListEmployeesPaginatedFilters) {
  return useQuery({
    queryKey: ["employees", "paginated", filters],
    queryFn: async () => {
      let query = supabase.from("employees").select("*", { count: "exact" });
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.statuses?.length) query = query.in("status", [...filters.statuses]);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.administersMedications !== undefined) {
        query = query.eq("administers_medications", filters.administersMedications);
      }
      const search = filters.search?.trim();
      if (search) {
        const like = containsFilterValue(search);
        query = query.or(`first_name.ilike.${like},last_name.ilike.${like},job_title.ilike.${like},department.ilike.${like}`);
      }
      // filters.sortField ultimately comes from a URL query param on Employees.tsx (via
      // useUrlState), so it isn't guaranteed to be a real EmployeeSortField -- a hand-edited or
      // bookmarked ?sortField=foo would otherwise look up SORT_COLUMNS['foo'] (undefined) and send
      // .order(undefined, ...) to PostgREST, which 400s with no surfaced error. Fall back to the
      // default column for anything unrecognized instead of trusting the caller's value.
      const column = SORT_COLUMNS[filters.sortField ?? "lastName"] ?? SORT_COLUMNS.lastName;
      query = query.order(column, { ascending: (filters.sortDir ?? "asc") === "asc" });
      // Secondary tiebreaker so equal-value rows (e.g. many employees with the same status) don't
      // reorder between pages as the underlying table changes between requests. `last_name` is not
      // unique either -- two Smiths on one roster leave a run of equal keys that a page boundary
      // can fall inside -- so the primary key closes it out and makes the sort a total order.
      if (column !== "last_name") query = query.order("last_name", { ascending: true });
      query = query.order("id", { ascending: true });
      const [from, to] = rangeFor(filters.page, filters.pageSize);
      query = query.range(from, to);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
    placeholderData: (previousData) => previousData,
  });
}

export function useGetEmployee(id: string | undefined) {
  return useQuery({
    queryKey: ["employees", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useGetEmployeeByProfileId(profileId: string | undefined) {
  return useQuery({
    queryKey: ["employees", "by-profile", profileId],
    queryFn: async () => {
      // maybeSingle(), not single(): now that every role (not just employee) can reach pages that
      // use this hook, "no employees row yet" (org_admin/auditor/platform_admin pre-self-enroll)
      // is a normal, expected result, not an error condition -- single() would instead throw on
      // zero rows, and react-query's default retry: 3 would retry that "error" with backoff for
      // several seconds before finally giving up and settling `data` to undefined anyway.
      const { data, error } = await supabase.from("employees").select("*").eq("profile_id", profileId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!profileId,
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EmployeeInsert) => {
      const { data, error } = await supabase.from("employees").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    // The training matrix is keyed by employee as well as by record, so hiring, editing
    // (job title, facility, meds/trainer flags), or removing someone changes which rows and
    // columns it returns.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: TRAINING_MATRIX_QUERY_KEY });
    },
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: EmployeeUpdate & { id: string }) => {
      const { data, error } = await supabase.from("employees").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    // The training matrix is keyed by employee as well as by record, so hiring, editing
    // (job title, facility, meds/trainer flags), or removing someone changes which rows and
    // columns it returns.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: TRAINING_MATRIX_QUERY_KEY });
    },
  });
}

// There is deliberately no useDeleteEmployee.
//
// `delete from employees` cannot succeed for any employee this product created. Every insert fires
// app_private.shadow_new_employee_lifecycle, which writes a workforce_employee_links row and an
// employment_lifecycle_events row, both referencing the employee `on delete restrict`; employment
// episodes are refused as retained evidence too. So the request was answered with a foreign-key
// error every time, behind a dialog promising to remove "all associated training data".
//
// The supported way to end someone's employment is the lifecycle wizard's `terminate` transition
// (/app/employee-lifecycle), which closes the employment episode and records the event rather than
// destroying the evidence of it.
