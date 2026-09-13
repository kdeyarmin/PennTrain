import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";
import { cloneCourseVideoBody } from "@/lib/courseVideoGeneration";
import { executeNativeDraft, nativeDraftIntent, type GovernedDraftSource, type NativeDraftIntent } from "@/lib/governedLearningDraft";
import { executeNativeCreation, nativeCreationIntent, readNativeCreationOptions, type CourseCreationForm, type NativeCreationIntent } from "@/lib/governedLearningCreation";

export type Course = Tables<"courses">;
export type CourseInsert = TablesInsert<"courses">;
export type CourseUpdate = TablesUpdate<"courses">;
export type CourseVersion = Tables<"course_versions">;
export type CourseVersionInsert = TablesInsert<"course_versions">;
export type CourseBlock = Tables<"course_blocks">;
export type CourseBlockInsert = TablesInsert<"course_blocks">;
export type CourseBlockUpdate = TablesUpdate<"course_blocks">;

export interface ListCoursesFilters {
  organizationId?: string;
  status?: string;
  // Restricts the list to system-catalog courses (organization_id IS NULL).
  // platform_admin's RLS grant bypasses the org filter entirely, so without this
  // its unfiltered list interleaves every organization's courses -- this is the
  // opt-in "System Catalog" view for that role (see Courses.tsx).
  systemOnly?: boolean;
}

export function isCourseVersionLearnerReady(
  version: Pick<CourseVersion, "status" | "ai_generated" | "ai_reviewed_at"> | null | undefined,
): boolean {
  return !!version && version.status === "published" && (!version.ai_generated || !!version.ai_reviewed_at);
}

export async function getCourseVersionPublishIssues(versionId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_course_version_publish_issues", { p_version_id: versionId });
  if (error) throw error;
  return data ?? [];
}

export function useCourseVersionPublishIssues(versionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["courses", "versions", versionId, "publish-issues"],
    queryFn: () => getCourseVersionPublishIssues(versionId!),
    enabled: enabled && !!versionId,
  });
}

// Mirrors self_enroll_course()'s own organization-scope check. courses_select RLS lets
// platform_admin see every organization's courses (its RLS grant bypasses the org filter
// entirely -- see ListCoursesFilters.systemOnly above), but self_enroll_course rejects enrolling
// in a course whose organization_id doesn't match the caller's own employee record (a
// platform_admin's is always the dedicated internal org, never a real tenant's). Without this,
// a platform_admin's "Available Training"/"Start Training" would offer every tenant's courses,
// each guaranteed to fail with a destructive error toast the moment they're clicked.
export function canEnrollInCourse(course: Pick<Course, "organization_id">, employeeOrganizationId: string | undefined): boolean {
  return course.organization_id === null || course.organization_id === employeeOrganizationId;
}

// Courses can be org-owned or system-catalog (organization_id null); RLS already
// scopes which rows a given user can see (their org's courses + the system
// catalog), so we only apply an organization_id filter when the caller explicitly
// asks for one -- we never filter out null-org rows client-side by default.
export function useListCourses(filters: ListCoursesFilters = {}) {
  return useQuery({
    queryKey: ["courses", filters],
    queryFn: async () => {
      let query = supabase.from("courses").select("*").order("title");
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.systemOnly) query = query.is("organization_id", null);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetCourse(id: string | undefined) {
  return useQuery({
    queryKey: ["courses", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("courses").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateCourse() {
  const queryClient = useQueryClient();
  const intent = useRef<NativeCreationIntent | null>(null);
  return useMutation({
    mutationFn: async (payload: CourseCreationForm) => {
      intent.current = nativeCreationIntent(intent.current, payload);
      return executeNativeCreation(intent.current, payload);
    },
    onSuccess: () => { intent.current = null; return queryClient.invalidateQueries({ queryKey: ["courses"] }); },
  });
}

export function useLearningCreationOptions(enabled: boolean) {
  return useInfiniteQuery({ queryKey: ['learning_creation_options'], initialPageParam: 0,
    queryFn: ({ pageParam }) => readNativeCreationOptions(pageParam),
    getNextPageParam: page => page.nextOffset ?? undefined, enabled });
}

export function useUpdateCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: CourseUpdate & { id: string }) => {
      const { data, error } = await supabase.from("courses").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["courses"] }),
  });
}

// Course versions are scoped under the "courses" query-key namespace (rather than
// their own top-level "course_versions" key) so that a broad invalidateQueries({
// queryKey: ["courses"] }) -- e.g. after useUpdateCourse changes current_version_id
// -- also sweeps every version list/detail query via TanStack's default prefix match.

export function useListCourseVersions(courseId: string | undefined) {
  return useQuery({
    queryKey: ["courses", "versions", courseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_versions")
        .select("*")
        .eq("course_id", courseId!)
        .order("version_number");
      if (error) throw error;
      return data;
    },
    enabled: !!courseId,
  });
}

export function useGetCourseVersion(id: string | undefined) {
  return useQuery({
    queryKey: ["courses", "versions", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("course_versions").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useListCourseVersionsByIds(ids: string[]) {
  const normalizedIds = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ["courses", "versions", "by-ids", normalizedIds],
    queryFn: async () => {
      if (normalizedIds.length === 0) return [] as CourseVersion[];
      const { data, error } = await supabase
        .from("course_versions")
        .select("*")
        .in("id", normalizedIds)
        .order("version_number");
      if (error) throw error;
      return data;
    },
  });
}

export function useListCourseVersionsForCourses(courseIds: string[]) {
  const normalizedCourseIds = [...new Set(courseIds)].sort();
  return useQuery({
    queryKey: ["courses", "versions", "by-course-ids", normalizedCourseIds],
    queryFn: async () => {
      if (normalizedCourseIds.length === 0) return [] as CourseVersion[];
      const { data, error } = await supabase
        .from("course_versions")
        .select("*")
        .in("course_id", normalizedCourseIds)
        .order("version_number");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCourseVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseVersionInsert) => {
      const { data, error } = await supabase.from("course_versions").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // Refresh this course's version list...
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.course_id] });
      // ...and the courses list/detail too: creating a version doesn't itself change
      // courses.current_version_id (that's a separate useUpdateCourse call the calling
      // page makes to publish it), but callers may still be showing derived state.
      queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
  });
}

export interface CloneCourseVersionPayload {
  sourceVersionId: string;
  courseId: string;
  organizationId: string | null;
  versionNumber: number;
  title: string;
}

// The native and Hub paths share one transaction for definitions and policy copying.
export function useCloneCourseVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CloneCourseVersionPayload) => {
      const { data, error } = await supabase.rpc("clone_course_version", {
        p_source_version_id: payload.sourceVersionId,
        p_course_id: payload.courseId,
        p_organization_id: payload.organizationId ?? undefined,
        p_version_number: payload.versionNumber,
        p_title: payload.title,
      });
      if (error) throw error;
      return { id: data, course_id: payload.courseId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.course_id] });
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      queryClient.invalidateQueries({ queryKey: ["course_blocks", data.id] });
    },
  });
}

// Published versions are DB-locked immutable: a trigger rejects updates once
// version.status === 'published', surfacing as a Postgres error via `error` above.
// Callers should generally only offer an edit UI while version.status === 'draft',
// but we don't try to pre-guess/suppress the DB error here beyond that.
export function useUpdateCourseVersion() {
  const queryClient = useQueryClient();
  const intent = useRef<NativeDraftIntent | null>(null);
  return useMutation({
    mutationFn: async ({ id, governedSource, reason, ...payload }: TablesUpdate<"course_versions"> & { id: string; governedSource?: GovernedDraftSource; reason?: string }) => {
      if (governedSource) {
        if (id !== governedSource.versionId || Object.keys(payload).some(key => !['title', 'description'].includes(key))) throw new Error('Invalid governed version edit.');
        const patch = { version: { ...(payload.title !== undefined ? { title: payload.title } : {}), ...(payload.description !== undefined ? { description: payload.description } : {}) } };
        const explanation = reason?.trim() ?? '';
        intent.current = nativeDraftIntent(intent.current, { sourceRevision: governedSource.sourceRevision, patch, reason: explanation });
        await executeNativeDraft(governedSource, 'learning.patchDraft', intent.current.requestId, explanation, patch);
        const { data, error } = await supabase.from('course_versions').select('*').eq('id', id).single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.from("course_versions").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.id] });
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.course_id] });
    },
  });
}

export function usePublishCourseVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (courseVersionId: string) => {
      const { data, error } = await supabase.rpc("publish_course_version", { p_course_version_id: courseVersionId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      queryClient.invalidateQueries({ queryKey: ["course_blocks"] });
    },
  });
}

export function useUnpublishCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseId, reason }: { courseId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("unpublish_course", {
        p_course_id: courseId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["courses", data.id], data);
      queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
  });
}

export function useListCourseBlocks(courseVersionId: string | undefined) {
  return useQuery({
    queryKey: ["course_blocks", courseVersionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_blocks")
        .select("*")
        .eq("course_version_id", courseVersionId!)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!courseVersionId,
  });
}

export function useGetCourseBlock(id: string | undefined) {
  return useQuery({
    queryKey: ["course_blocks", "single", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("course_blocks").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateCourseBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseBlockInsert) => {
      const { data, error } = await supabase.from("course_blocks").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["course_blocks", data.course_version_id] });
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.course_version_id, "publish-issues"] });
    },
  });
}

export function useUpdateCourseBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: CourseBlockUpdate & { id: string }) => {
      const { data, error } = await supabase.from("course_blocks").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["course_blocks", data.course_version_id] });
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.course_version_id, "publish-issues"] });
    },
  });
}

export function useDeleteCourseBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, courseVersionId }: { id: string; courseVersionId: string }) => {
      const { error } = await supabase.from("course_blocks").delete().eq("id", id);
      if (error) throw error;
      return { courseVersionId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["course_blocks", data.courseVersionId] });
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.courseVersionId, "publish-issues"] });
    },
  });
}

/**
 * Correcting a published course block in an emergency (BACKLOG.md G12.2).
 *
 * Published versions are locked, and that lock is the point: learners are being assessed against
 * what they were shown, so content cannot move underneath a completion record. But a published
 * course can still contain something that has to change now rather than at the next version -- a
 * wrong medication dose, a rescinded regulation, a named person who must not be named.
 *
 * `admin_emergency_update_course_block` is that exit, and it had no caller, so the only options
 * were to leave the error published or to unpublish the course. It is platform-admin only, demands
 * a written reason of at least ten characters, and writes the before and after into `audit_logs` --
 * the correction is recorded as an exception, which is what makes it usable without eroding the
 * lock it steps around.
 */
export function useEmergencyUpdateCourseBlock(courseVersionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      blockId: string;
      reason: string;
      title?: string;
      body?: unknown;
      videoUrl?: string;
      documentId?: string;
      expectedMediaAssetId?: string | null;
      expectedSourceRevision?: string | null;
      expectedBlock?: CourseBlock;
    }) => {
      // Only the fields being corrected are sent. The function coalesces each against the current
      // value, so omitting one leaves it alone rather than blanking it.
      const { error } = await supabase.rpc("admin_emergency_update_course_block" as never, {
        p_course_block_id: input.blockId,
        p_reason: input.reason,
        p_expected_media_asset_id: input.expectedMediaAssetId ?? null,
        p_expected_source_revision: input.expectedSourceRevision ?? null,
        p_expected_block: input.expectedBlock ?? null,
        ...(input.title !== undefined ? { p_title: input.title } : {}),
        ...(input.body !== undefined ? { p_body: input.body } : {}),
        ...(input.videoUrl !== undefined ? { p_video_url: input.videoUrl } : {}),
        ...(input.documentId !== undefined ? { p_document_id: input.documentId } : {}),
      } as never);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course_blocks", courseVersionId] });
    },
  });
}
