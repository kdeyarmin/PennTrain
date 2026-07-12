import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type CompetencyTemplate = Tables<"competency_templates">;
export type CompetencyTemplateInsert = TablesInsert<"competency_templates">;
export type CompetencyTemplateUpdate = TablesUpdate<"competency_templates">;

export type CompetencyTemplateItem = Tables<"competency_template_items">;
export type CompetencyTemplateItemInsert = TablesInsert<"competency_template_items">;

export type CompetencyRecord = Tables<"competency_records">;
export type CompetencyRecordInsert = TablesInsert<"competency_records">;

export type CompetencyRecordItem = Tables<"competency_record_items">;
export type CompetencyRecordItemInsert = TablesInsert<"competency_record_items">;

// ---------------------------------------------------------------------------
// competency_templates -- catalog pattern, same shape as useCourses.ts's
// courses. organization_id is nullable: null rows are system-wide templates
// visible to every org, non-null rows belong to one org. RLS already scopes
// SELECT to "system row or my org's row", so we never filter null-org rows
// out client-side.
// ---------------------------------------------------------------------------

export function useListCompetencyTemplates() {
  return useQuery({
    queryKey: ["competency_templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("competency_templates").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useCompetencies.ts
export function useGetCompetencyTemplate(id: string | undefined) {
  return useQuery({
    queryKey: ["competency_templates", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("competency_templates").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

=======
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useCompetencies.ts
export function useCreateCompetencyTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CompetencyTemplateInsert) => {
      const { data, error } = await supabase.from("competency_templates").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["competency_templates"] }),
  });
}

export function useUpdateCompetencyTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: CompetencyTemplateUpdate & { id: string }) => {
      const { data, error } = await supabase.from("competency_templates").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["competency_templates"] }),
  });
}

export function useDeleteCompetencyTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("competency_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["competency_templates"] }),
  });
}

// ---------------------------------------------------------------------------
// competency_template_items -- ordered checklist items under a template.
// Keyed under their own top-level "competency_template_items" key (parameterized
// by template_id), mirroring useCourses.ts's course_blocks -- NOT nested under
// the "competency_templates" key, so editing items doesn't need to bust the
// whole templates list.
// ---------------------------------------------------------------------------

export function useListCompetencyTemplateItems(templateId: string | undefined) {
  return useQuery({
    queryKey: ["competency_template_items", templateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competency_template_items")
        .select("*")
        .eq("template_id", templateId!)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!templateId,
  });
}

export function useAddCompetencyTemplateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CompetencyTemplateItemInsert) => {
      const { data, error } = await supabase.from("competency_template_items").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["competency_template_items", data.template_id] }),
  });
}

// Used for both inline text edits and the up/down reorder controls (which just
// swap two rows' sort_order). Not part of the named type-alias list the rest of
// this file exports, so it's typed inline off TablesUpdate the same way
// useCourses.ts's useUpdateCourseVersion does for a field that has no dedicated
// alias.
export function useUpdateCompetencyTemplateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: TablesUpdate<"competency_template_items"> & { id: string }) => {
      const { data, error } = await supabase.from("competency_template_items").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["competency_template_items", data.template_id] }),
  });
}

export function useRemoveCompetencyTemplateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    // templateId is passed in (rather than inferred) so the delete -- which returns
    // no row -- can still invalidate the specific ["competency_template_items", templateId]
    // key. Same pattern as useQuizzes.ts's useDeleteQuizQuestion.
    mutationFn: async ({ id }: { id: string; templateId: string }) => {
      const { error } = await supabase.from("competency_template_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["competency_template_items", variables.templateId] }),
  });
}

// ---------------------------------------------------------------------------
// competency_records / competency_record_items
//
// Unlike course_progress, this pair is TRAINER-AUTHORED: RLS gives the
// employee read-only access to their own records (via owns_employee() in the
// SELECT policy only) but insert/update require org_admin/facility_manager/
// trainer + is_assigned_to_facility(facility_id). There is intentionally no
// "self-service" create/update path here -- callers must not offer employees
// any UI that calls useCreateCompetencyRecord.
//
<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useCompetencies.ts
// Note on facility_id: a BEFORE INSERT trigger (stamp_org_from_employee)
// overwrites organization_id from the employee row, but it does NOT touch
// facility_id -- unlike some other tables in this schema, competency_records
// only auto-stamps organization_id. Whatever facility_id the caller sends is
// the value RLS's is_assigned_to_facility(facility_id) check runs against, so
// callers must pass the employee's real facility_id, not a placeholder.
=======
// Note on facility_id: a BEFORE INSERT trigger (stamp_scope_from_employee) overwrites BOTH
// organization_id AND facility_id from the employee row (fixed in migration
// 20260704164627_fix_codex_review_findings.sql -- it previously only stamped organization_id,
// which let a caller spoof facility_id). RLS's is_assigned_to_facility(facility_id) check runs
// against the post-trigger, server-derived value, not whatever the client sent, so there is no
// facility-spoofing path here today. employee_training_records, practicums, and
// training_documents had the same pre-fix gap; it's closed for them too as of migration
// 20260704180646_stamp_facility_scope_from_employee_on_writes.sql -- don't treat an *absence*
// of this note elsewhere in the codebase as "safe to copy the old client-supplied-facility_id
// pattern," it wasn't.
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useCompetencies.ts
// ---------------------------------------------------------------------------

export interface ListCompetencyRecordsFilters {
  employeeId?: string;
  facilityId?: string;
  templateId?: string;
}

<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useCompetencies.ts
export function useListCompetencyRecords(filters: ListCompetencyRecordsFilters = {}) {
=======
// `options.enabled` matters for callers that intend to scope by employeeId but don't have one yet
// (e.g. an employee self-service page before its employees row has resolved) -- every filter field
// here is applied only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes
// to "no filter at all," silently returning every record RLS permits. Passing `enabled: false` in
// that case (rather than `employeeId: undefined`) is the only way to get "no results yet" instead
// of firing twice (once unscoped, once scoped) on every page load. Mirrors
// useCourseAssignments.ts's useListCourseAssignments. Defaults to `undefined`, which react-query
// treats as "always enabled," so every existing caller that doesn't pass `options` is unaffected.
export function useListCompetencyRecords(filters: ListCompetencyRecordsFilters = {}, options: { enabled?: boolean } = {}) {
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useCompetencies.ts
  return useQuery({
    queryKey: ["competency_records", filters],
    queryFn: async () => {
      let query = supabase.from("competency_records").select("*").order("evaluation_date", { ascending: false });
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.templateId) query = query.eq("template_id", filters.templateId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useCompetencies.ts
  });
}

export function useGetCompetencyRecord(id: string | undefined) {
  return useQuery({
    queryKey: ["competency_records", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("competency_records").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
=======
    enabled: options.enabled,
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useCompetencies.ts
  });
}

export interface CreateCompetencyRecordItemInput {
  template_item_id: string | null;
  result: "met" | "not_met" | "na";
  notes?: string | null;
}

export type CreateCompetencyRecordPayload = CompetencyRecordInsert & {
  items: CreateCompetencyRecordItemInput[];
};

// ---------------------------------------------------------------------------
// useCreateCompetencyRecord -- ONE call, TWO writes.
//
// An evaluator fills out an entire checklist in one sitting (header fields --
// employee/template/evaluation_date/overall_result/signed_at -- plus a
// met/not_met/na result per checklist item) and submits it as a single unit.
// There's no meaningful intermediate state where the record header exists but
// none of its items do, so this hook accepts the whole thing as one payload
// (the competency_records columns PLUS an `items` array) and internally:
//   1. inserts the competency_records row, then
//   2. batch-inserts one competency_record_items row per submitted item,
//      each stamped with the new record's id as competency_record_id.
// It returns the created record (not the items) -- a caller that needs the
// items back (e.g. to render the detail view it just created) should follow
// up with useListCompetencyRecordItems(record.id), which is also what the
// read-only detail view uses.
//
// IMPORTANT: this is NOT a database transaction. PostgREST issues these as
// two separate HTTP requests, so if step 2 fails, step 1's row is NOT rolled
// back -- the record row will exist with zero items. To make that failure
// mode visible instead of silently swallowing it, the items-insert error is
// re-thrown as a new Error whose message calls out that the header saved and
// includes the record's id, so a caller/toast can tell the user "the record
// saved, but items didn't" rather than reporting total failure.
// ---------------------------------------------------------------------------
export function useCreateCompetencyRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ items, ...recordPayload }: CreateCompetencyRecordPayload) => {
      const { data: record, error: recordError } = await supabase
        .from("competency_records")
        .insert(recordPayload)
        .select()
        .single();
      if (recordError) throw recordError;

      if (items.length > 0) {
        const itemRows: CompetencyRecordItemInsert[] = items.map((item) => ({
          competency_record_id: record.id,
          template_item_id: item.template_item_id,
          result: item.result,
          notes: item.notes || null,
        }));
        const { error: itemsError } = await supabase.from("competency_record_items").insert(itemRows);
        if (itemsError) {
          throw new Error(
            `The competency record was saved, but its checklist items failed to save: ${itemsError.message}. Record id: ${record.id}.`,
          );
        }
      }

      return record;
    },
    onSuccess: (record) => {
      queryClient.invalidateQueries({ queryKey: ["competency_records"] });
      queryClient.invalidateQueries({ queryKey: ["competency_record_items", record.id] });
    },
  });
}

export function useListCompetencyRecordItems(recordId: string | undefined) {
  return useQuery({
    queryKey: ["competency_record_items", recordId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competency_record_items")
        .select("*")
        .eq("competency_record_id", recordId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!recordId,
  });
}
