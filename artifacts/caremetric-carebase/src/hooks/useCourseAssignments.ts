import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";
import { rangeFor } from "@/lib/utils";

export type CourseAssignment = Tables<"course_assignments">;
export type CourseAssignmentInsert = TablesInsert<"course_assignments">;
export type CourseAssignmentUpdate = TablesUpdate<"course_assignments">;

/**
 * The statuses course_assignments_one_open_per_course_idx treats as open, in the same order the
 * index's WHERE clause lists them. `completed` and `canceled` are outside it on purpose: annual
 * retraining is "assign it again once the last one is done".
 */
export const OPEN_ASSIGNMENT_STATUSES = ["assigned", "in_progress", "overdue", "paused"] as const;

export type CourseProgress = Tables<"course_progress">;
export type CourseProgressInsert = TablesInsert<"course_progress">;
export type CourseProgressUpdate = TablesUpdate<"course_progress">;

export interface ListCourseAssignmentsFilters {
  employeeId?: string;
  courseId?: string;
  status?: string;
  facilityId?: string;
  trainingPlanId?: string;
}

// `enabled` matters for callers that intend to scope by employeeId but don't have one yet (e.g.
// MyCourses.tsx before an account's employees row exists) -- every filter field here is applied
// only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes to "no filter at
// all," silently returning every assignment RLS permits. Passing `enabled: false` in that case
// (rather than `employeeId: undefined`) is the only way to get "no results yet" instead of "every
// org-wide (or platform-wide, for platform_admin) assignment," since RLS alone doesn't stand in
// for a missing employee_id filter.
export function useListCourseAssignments(filters: ListCourseAssignmentsFilters = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["course_assignments", filters],
    queryFn: async () => {
      let query = supabase.from("course_assignments").select("*").order("assigned_at");
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.courseId) query = query.eq("course_id", filters.courseId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.trainingPlanId) query = query.eq("training_plan_id", filters.trainingPlanId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: options.enabled,
  });
}

export interface ListCourseAssignmentsPaginatedFilters extends ListCourseAssignmentsFilters {
  // course_assignments has no employee-name/course-title columns of its own to search --
  // CourseAssignments.tsx resolves its free-text search against the employees/courses lists it
  // already has loaded (both are inherently bounded -- org headcount / catalog size -- unlike this
  // table) and passes the matching ids here, rather than this hook attempting a cross-table
  // search. Omit both (or pass undefined) for "no text search active".
  matchingEmployeeIds?: string[];
  matchingCourseIds?: string[];
  page: number;
  pageSize: number;
}

// Server-side pagination for the Training Assignments admin table -- mirrors useEmployees.ts's
// useListEmployeesPaginated .range()-based pattern. course_assignments "can run into the
// thousands for a mid-size org" (see CourseAssignments.tsx's own note), so unlike
// useListCourseAssignments above (left unbounded -- MyCourses.tsx, TrainingPlans.tsx, and
// EmployeeDashboard.tsx all still need "every assignment matching this filter" rather than one
// page of it), this variant is for the paginated admin list only.
export function useListCourseAssignmentsPaginated(filters: ListCourseAssignmentsPaginatedFilters) {
  return useQuery({
    queryKey: ["course_assignments", "paginated", filters],
    queryFn: async () => {
      let query = supabase.from("course_assignments").select("*", { count: "exact" });
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.courseId) query = query.eq("course_id", filters.courseId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.trainingPlanId) query = query.eq("training_plan_id", filters.trainingPlanId);
      if (filters.matchingEmployeeIds || filters.matchingCourseIds) {
        const empIds = filters.matchingEmployeeIds ?? [];
        const courseIds = filters.matchingCourseIds ?? [];
        if (empIds.length === 0 && courseIds.length === 0) {
          // The search term matched no employee or course at all -- short-circuit to "no rows"
          // rather than sending a query with no id filter at all (which would return everything).
          return { rows: [] as CourseAssignment[], count: 0 };
        }
        const clauses: string[] = [];
        if (empIds.length > 0) clauses.push(`employee_id.in.(${empIds.join(",")})`);
        if (courseIds.length > 0) clauses.push(`course_id.in.(${courseIds.join(",")})`);
        query = query.or(clauses.join(","));
      }
      // Most recently assigned first -- matches the client-side sort CourseAssignments.tsx applied
      // before this hook existed. The `id` tie-break keeps the page boundaries stable: assigning a
      // course to a whole facility writes every row with the same `assigned_at`, so `assigned_at`
      // alone is one long run of equal keys and Postgres may order each page's request differently
      // inside it -- putting the same assignment on two pages and none on a third.
      query = query.order("assigned_at", { ascending: false }).order("id", { ascending: true });
      const [from, to] = rangeFor(filters.page, filters.pageSize);
      query = query.range(from, to);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
    placeholderData: (previousData) => previousData,
  });
}

export function useGetCourseAssignment(id: string | undefined) {
  return useQuery({
    queryKey: ["course_assignments", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("course_assignments").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

/** What an assignment insert did -- the row, and whether it was already there. */
export interface CreateCourseAssignmentResult {
  assignment: CourseAssignment;
  /** The employee already had this course open; nothing new was created. */
  alreadyAssigned: boolean;
}

/**
 * Assigning a course somebody already has open is a no-op, not a failure (BACKLOG.md I12).
 *
 * 20260905060000 put one open assignment per (employee, course) into the table, because every
 * caller here is a bulk fan-out with no such check: re-assigning the annual course to everyone --
 * what an administrator does each year, and again after adding one late hire -- used to give every
 * learner who already had it a second identical row, with its own due date, its own line in My
 * Training, and its own overdue clock once they completed the other one.
 *
 * With the index in place that insert raises 23505. Throwing it would turn "they already have it"
 * into a red error beside the people who really did fail, on all four bulk surfaces. So the
 * duplicate is read back instead and reported as `alreadyAssigned`: the caller can say what
 * actually happened, and the same annual re-assignment is now safe to run twice.
 *
 * Only the open states are unique, so assigning again after the last one is completed -- which is
 * what annual retraining IS -- creates a new row exactly as before.
 */
export function useCreateCourseAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseAssignmentInsert): Promise<CreateCourseAssignmentResult> => {
      const { data, error } = await supabase.from("course_assignments").insert(payload).select().single();
      if (!error) return { assignment: data, alreadyAssigned: false };
      if (error.code !== "23505") throw error;

      const { data: existing, error: readError } = await supabase
        .from("course_assignments")
        .select("*")
        .eq("employee_id", payload.employee_id)
        .eq("course_id", payload.course_id)
        .in("status", OPEN_ASSIGNMENT_STATUSES)
        .maybeSingle();
      // A 23505 from some other constraint, or a row RLS will not show us: the original error is
      // the honest thing to report, not a second one about the lookup.
      if (readError || !existing) throw error;
      return { assignment: existing, alreadyAssigned: true };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course_assignments"] }),
  });
}

// Wires the assigned -> in_progress transition (previously dead -- protect_course_assignment_fields()
// reverts any plain client .update() of status, so this has to go through the same
// set_config('app.privileged_write', 'on', true) RPC pattern complete_course_assignment already uses.
export function useStartCourseAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase.rpc("start_course_assignment", { p_assignment_id: assignmentId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course_assignments"] }),
  });
}

// Any role can self-enroll in a published course -- the RPC (security definer) finds or
// lazily provisions the caller's own employees row, then creates (or reuses) their
// course_assignments row. Returns the assignment id so the caller can navigate straight in.
export function useSelfEnrollCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (courseId: string) => {
      const { data, error } = await supabase.rpc("self_enroll_course", { p_course_id: courseId });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      // self_enroll_course may lazily create the caller's pseudo-employee row.
      // Await both refreshes before the component-level success handler navigates
      // to TakeCourse, otherwise that page can reuse a cached null employee.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["course_assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
      ]);
    },
  });
}

export function useCompleteCourseAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { data, error } = await supabase.rpc("complete_course_assignment", { p_assignment_id: assignmentId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course_assignments"] });
      queryClient.invalidateQueries({ queryKey: ["course_progress"] });
      queryClient.invalidateQueries({ queryKey: ["certificates"] });
      // complete_course_assignment() bridges into employee_training_records and
      // runs recalculate_compliance_core (statuses, hour buckets, alerts) --
      // refresh those caches too so the training matrix and annual-hours
      // widgets don't stay stale for a full staleTime window.
      queryClient.invalidateQueries({ queryKey: ["training_records"] });
      queryClient.invalidateQueries({ queryKey: ["training_hour_buckets"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}

export function useGetCourseProgress(assignmentId: string | undefined) {
  return useQuery({
    queryKey: ["course_progress", assignmentId],
    queryFn: async () => {
      // course_progress rows are created lazily on first upsert, so a brand-new
      // assignment legitimately has none -- maybeSingle() returns null instead
      // of erroring (and retrying) on zero rows.
      const { data, error } = await supabase
        .from("course_progress")
        .select("*")
        .eq("assignment_id", assignmentId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!assignmentId,
  });
}

export function useUpsertCourseProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseProgressInsert) => {
      const { data, error } = await supabase
        .from("course_progress")
        .upsert(payload, { onConflict: "assignment_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["course_progress", data.assignment_id] });
    },
  });
}
