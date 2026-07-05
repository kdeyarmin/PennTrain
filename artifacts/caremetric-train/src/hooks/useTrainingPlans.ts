import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";
import { useCreateCourseAssignment } from "./useCourseAssignments";

export type TrainingPlan = Tables<"training_plans">;
export type TrainingPlanInsert = TablesInsert<"training_plans">;
export type TrainingPlanUpdate = TablesUpdate<"training_plans">;

export type TrainingPlanItem = Tables<"training_plan_items">;
export type TrainingPlanItemInsert = TablesInsert<"training_plan_items">;
export type TrainingPlanItemUpdate = TablesUpdate<"training_plan_items">;

// ---------------------------------------------------------------------------
// Training plans
// ---------------------------------------------------------------------------

export function useListTrainingPlans() {
  return useQuery({
    queryKey: ["training_plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_plans").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useGetTrainingPlan(id: string | undefined) {
  return useQuery({
    queryKey: ["training_plans", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_plans").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateTrainingPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TrainingPlanInsert) => {
      const { data, error } = await supabase.from("training_plans").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_plans"] }),
  });
}

export function useUpdateTrainingPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: TrainingPlanUpdate & { id: string }) => {
      const { data, error } = await supabase.from("training_plans").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_plans"] }),
  });
}

export function useDeleteTrainingPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // training_plan_items.training_plan_id is ON DELETE CASCADE, so the
      // DB cleans up the plan's items itself -- no client-side fan-out delete needed.
      const { error } = await supabase.from("training_plans").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_plans"] }),
  });
}

// ---------------------------------------------------------------------------
// Training plan items
//
// Items are scoped under the "training_plans" query-key namespace (same
// convention useCourses.ts uses for course_versions) so a broad
// invalidateQueries({ queryKey: ["training_plans"] }) also sweeps every
// plan's item list via TanStack's default prefix match.
// ---------------------------------------------------------------------------

export function useListTrainingPlanItems(planId: string | undefined) {
  return useQuery({
    queryKey: ["training_plans", "items", planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("training_plan_id", planId!)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!planId,
  });
}

// training_plan_items has a DB CHECK enforcing exactly one of course_id /
// training_type_id is set. TrainingPlanItemInsert (generated from the table)
// allows both/neither to be set at the type level, so we narrow with our own
// discriminated union here -- the compiler, not just Postgres, now rejects a
// payload that sets both or neither.
export type AddTrainingPlanItemPayload =
  | {
      training_plan_id: string;
      course_id: string;
      training_type_id?: never;
      sort_order?: number;
      is_required?: boolean;
    }
  | {
      training_plan_id: string;
      training_type_id: string;
      course_id?: never;
      sort_order?: number;
      is_required?: boolean;
    };

export function useAddTrainingPlanItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AddTrainingPlanItemPayload) => {
      // postgrest-js's .insert() overloads don't distribute cleanly over a
      // discriminated union argument (it tries to match the union as a whole
      // against a single insert shape and rejects both branches) -- the
      // exclusivity is already enforced at the call site by
      // AddTrainingPlanItemPayload, so this cast is just working around that
      // typing limitation, not loosening the actual guarantee.
      const { data, error } = await supabase
        .from("training_plan_items")
        .insert(payload as TrainingPlanItemInsert)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) =>
      queryClient.invalidateQueries({ queryKey: ["training_plans", "items", data.training_plan_id] }),
  });
}

// Used for reordering (sort_order) and toggling is_required -- never touches
// course_id/training_type_id, so the exactly-one-target invariant can't be
// broken from here.
export function useUpdateTrainingPlanItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      trainingPlanId,
      ...payload
    }: {
      id: string;
      trainingPlanId: string;
      sort_order?: number;
      is_required?: boolean;
    }) => {
      const { data, error } = await supabase
        .from("training_plan_items")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return { ...data, trainingPlanId };
    },
    onSuccess: (data) =>
      queryClient.invalidateQueries({ queryKey: ["training_plans", "items", data.trainingPlanId] }),
  });
}

export function useRemoveTrainingPlanItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, trainingPlanId }: { id: string; trainingPlanId: string }) => {
      const { error } = await supabase.from("training_plan_items").delete().eq("id", id);
      if (error) throw error;
      return { trainingPlanId };
    },
    onSuccess: (data) =>
      queryClient.invalidateQueries({ queryKey: ["training_plans", "items", data.trainingPlanId] }),
  });
}

// ---------------------------------------------------------------------------
// Applying a plan to an employee
//
// A training plan can mix two kinds of items:
//   - course-type items (course_id set) -> a real, trackable unit of LMS
//     work an employee can be assigned and complete, via course_assignments.
//   - training_type-type items (training_type_id set) -> there's no LMS
//     content to assign, but applying the plan still needs to do *something*
//     other than silently no-op: it ensures a 'missing' employee_training_records
//     shell exists for that (employee, training_type) pair via the
//     ensure_training_requirement_record() RPC (the same auto-assignment
//     engine used on hire/role-change), so the requirement shows up as a real
//     compliance gap instead of not existing at all until someone happens to
//     log a completion for it.
//
// Design note on fan-out (see task write-up in the PR/report as well):
// this hook composes useCreateCourseAssignment() -- calling that hook here,
// at the top of useApplyTrainingPlanToEmployee, is a normal hook
// composition (a "hook calling a hook"), which is allowed by the rules of
// hooks. What is NOT allowed is calling a hook *inside* a callback (e.g.
// inside this mutation's mutationFn) -- so the fan-out loop below calls the
// plain `mutateAsync` function that useCreateCourseAssignment() returns
// (not the hook itself) for each course-type item. That reuses the exact
// same insert logic/validation/query-invalidation as the single-course
// "Assign Course" flow on CourseAssignments.tsx, rather than duplicating a
// second `supabase.from("course_assignments").insert(...)` call here.
//
// This hook fans out over PLAN ITEMS for one employee. The calling page
// fans out over EMPLOYEES by calling this hook's mutation once per selected
// employee (see TrainingPlans.tsx) -- each level of looping stays with the
// concept it operates over instead of one hook trying to do both at once.
// ---------------------------------------------------------------------------

export interface ApplyTrainingPlanParams {
  planId: string;
  employeeId: string;
  facilityId: string;
  organizationId: string;
  assignedBy: string | null;
  dueDate?: string | null;
}

export interface ApplyTrainingPlanItemFailure {
  itemId: string;
  itemLabel: string | null;
  message: string;
}

export interface ApplyTrainingPlanResult {
  /** Number of course_assignments successfully created. */
  assigned: number;
  /** Number of training_type-type items that got (or already had) a training-record shell ensured. */
  requirementsEnsured: number;
  /** Course-type or training_type-type items that failed (e.g. course has no published version). */
  failed: ApplyTrainingPlanItemFailure[];
  /**
   * Set if the (non-fatal, best-effort) admin-facing "training plan assigned"
   * alert failed to write -- the course assignments above already succeeded
   * and are not rolled back, but this failure must still be visible rather
   * than silently swallowed.
   */
  alertWarning?: string;
}

export function useApplyTrainingPlanToEmployee() {
  const { mutateAsync: createCourseAssignment } = useCreateCourseAssignment();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ApplyTrainingPlanParams): Promise<ApplyTrainingPlanResult> => {
      const { data: items, error: itemsError } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("training_plan_id", params.planId);
      if (itemsError) throw itemsError;

      const allItems = items ?? [];
      const courseItems = allItems.filter(
        (item): item is TrainingPlanItem & { course_id: string } => item.course_id !== null,
      );
      const trainingTypeItems = allItems.filter(
        (item): item is TrainingPlanItem & { training_type_id: string } => item.training_type_id !== null,
      );

      if (allItems.length === 0) {
        return { assigned: 0, requirementsEnsured: 0, failed: [] };
      }

      // Flat select + client-side Map join, matching this codebase's usual
      // convention (see courseById/employeeById in CourseAssignments.tsx)
      // rather than a Postgres embedded-resource select.
      const courseIds = [...new Set(courseItems.map((item) => item.course_id))];
      const { data: courses, error: coursesError } = courseIds.length
        ? await supabase.from("courses").select("id, title, current_version_id").in("id", courseIds)
        : { data: [], error: null };
      if (coursesError) throw coursesError;
      const courseById = new Map((courses ?? []).map((c) => [c.id, c]));

      const trainingTypeIds = [...new Set(trainingTypeItems.map((item) => item.training_type_id))];
      const { data: trainingTypes, error: trainingTypesError } = trainingTypeIds.length
        ? await supabase.from("training_types").select("id, name").in("id", trainingTypeIds)
        : { data: [], error: null };
      if (trainingTypesError) throw trainingTypesError;
      const trainingTypeById = new Map((trainingTypes ?? []).map((t) => [t.id, t]));

      const courseResults = await Promise.allSettled(
        courseItems.map((item) => {
          const course = courseById.get(item.course_id);
          if (!course) throw new Error("Course not found");
          if (!course.current_version_id) {
            throw new Error(`"${course.title}" has no published version to assign`);
          }
          return createCourseAssignment({
            employee_id: params.employeeId,
            course_id: item.course_id,
            course_version_id: course.current_version_id,
            facility_id: params.facilityId,
            organization_id: params.organizationId,
            assigned_by: params.assignedBy,
            due_date: params.dueDate ?? null,
            training_plan_id: params.planId,
            training_plan_item_id: item.id,
          });
        }),
      );

      const requirementResults = await Promise.allSettled(
        trainingTypeItems.map((item) =>
          supabase
            .rpc("ensure_training_requirement_record", {
              p_employee_id: params.employeeId,
              p_training_type_id: item.training_type_id,
            })
            .then(({ error }) => {
              if (error) throw error;
            }),
        ),
      );

      let assigned = 0;
      let requirementsEnsured = 0;
      const failed: ApplyTrainingPlanItemFailure[] = [];
      courseResults.forEach((result, idx) => {
        if (result.status === "fulfilled") {
          assigned++;
          return;
        }
        const item = courseItems[idx];
        failed.push({
          itemId: item.id,
          itemLabel: courseById.get(item.course_id)?.title ?? null,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      });
      requirementResults.forEach((result, idx) => {
        if (result.status === "fulfilled") {
          requirementsEnsured++;
          return;
        }
        const item = trainingTypeItems[idx];
        failed.push({
          itemId: item.id,
          itemLabel: trainingTypeById.get(item.training_type_id)?.name ?? null,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      });

      // One admin-facing alert per plan application (not per course item --
      // the employee already gets a personal "New course assigned"
      // notification per item via the notify_course_assigned trigger). This
      // is best-effort: the course assignments above already succeeded and
      // are not undone if this fails, but the failure must still be surfaced
      // to the caller rather than silently swallowed.
      let alertWarning: string | undefined;
      if (assigned > 0 || requirementsEnsured > 0) {
        const { data: plan, error: planError } = await supabase
          .from("training_plans")
          .select("name")
          .eq("id", params.planId)
          .single();
        if (planError) {
          alertWarning = `Assignments succeeded, but couldn't record the "plan assigned" alert: ${planError.message}`;
        } else {
          const summary = [
            assigned > 0 ? `${assigned} course${assigned === 1 ? "" : "s"} assigned` : null,
            requirementsEnsured > 0 ? `${requirementsEnsured} requirement${requirementsEnsured === 1 ? "" : "s"} tracked` : null,
          ].filter(Boolean).join(", ");
          const { error: alertError } = await supabase.from("alerts").insert({
            organization_id: params.organizationId,
            facility_id: params.facilityId,
            employee_id: params.employeeId,
            alert_type: "training_plan_assigned",
            title: `Training plan assigned — ${plan?.name ?? "Training Plan"}`,
            message: `${plan?.name ?? "A training plan"} was applied (${summary}).`,
            severity: "info",
          });
          if (alertError) {
            alertWarning = `Assignments succeeded, but couldn't record the "plan assigned" alert: ${alertError.message}`;
          }
        }
      }

      return { assigned, requirementsEnsured, failed, alertWarning };
    },
    onSuccess: (result) => {
      if (result.assigned > 0) queryClient.invalidateQueries({ queryKey: ["alerts"] });
      if (result.requirementsEnsured > 0) queryClient.invalidateQueries({ queryKey: ["training_records"] });
    },
  });
}
