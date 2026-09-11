import { validProviderOperation, validProviderContext, validProviderPreview, validProviderResult, validProviderStatus, validProviderCommands, type ProviderOperation, type ProviderPreview } from '../../../../supabase/functions/_shared/learningProviderPolicy';
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, Json } from "@/lib/database.types";

export type CourseProviderProfile = Tables<"course_provider_profiles">;
export type CourseProviderProfileInsert = TablesInsert<"course_provider_profiles">;

/**
 * Training-provider and clinical-review metadata for one course.
 *
 * Readable by anyone who can already see the course -- the provider's name and credential are
 * printed on the learner's own certificate. Writable by platform_admin only, which is the role that
 * authors courses at all. None of it gates publication, assignment, or completion: a stale
 * next_review_due surfaces a reminder to administrators, it does not withdraw the course.
 */
export function useGetCourseProviderProfile(courseId: string | undefined) {
  return useQuery({
    queryKey: ["course_provider_profiles", courseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_provider_profiles")
        .select("*")
        .eq("course_id", courseId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!courseId,
  });
}

/** Admin-only context and commands use the same protected transaction as Hub. */
export function useCourseProviderPolicy(courseId: string, enabled: boolean, offset = 0) {
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: ['course_provider_policy', courseId], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_native_learning_provider_context', { p_course_id: courseId });
      if (error) throw error;
      if (!validProviderContext(data) || data.courseId !== courseId) throw new Error('Provider context did not match this course.');
      return data;
    } });
  const commands = useQuery({ queryKey: ['course_provider_commands', courseId, offset], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_native_learning_provider_commands', { p_course_id: courseId, p_offset: offset });
      if (error) throw error;
      if (!validProviderCommands(data) || data.nextOffset !== null && data.nextOffset !== offset + 20) throw new Error('Provider command page changed.');
      return data;
    } });
  const preview = useMutation({ mutationFn: async (op: Extract<ProviderOperation, { operation: 'preview' }>) => {
    if (!validProviderOperation(op) || op.courseId !== courseId) throw new Error('Review the provider fields before continuing.');
    const { data, error } = await supabase.rpc('preview_native_learning_provider_command', { p_request_id: op.requestId, p_course_id: courseId,
      p_context_revision: op.providerContextRevision, p_patch: op.patch as Json, p_reason: op.reason });
    if (error) throw error;
    if (!validProviderPreview(data) || data.courseId !== courseId || data.reason !== op.reason || data.providerContextRevision !== op.providerContextRevision
      || data.changes.some(c => !Object.hasOwn(op.patch, c.field) || op.patch[c.field] !== c.after)) throw new Error('Provider preview did not match the reviewed change.');
    return data;
  }, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['course_provider_commands', courseId] }); } });
  const apply = useMutation({ mutationFn: async (preview: ProviderPreview) => {
    const { data, error } = await supabase.rpc('apply_native_learning_provider_command', { p_command_id: preview.commandId, p_expected_digest: preview.previewDigest });
    if (error) throw error;
    if (!validProviderResult(data) || data.commandId !== preview.commandId || data.courseId !== courseId) throw new Error('Provider result did not match. Check the saved command before retrying.');
    return data;
  }, onSuccess: async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['course_provider_profiles', courseId] }),
      queryClient.invalidateQueries({ queryKey: ['course_provider_policy', courseId] }),
      queryClient.invalidateQueries({ queryKey: ['course_provider_commands', courseId] }),
      queryClient.invalidateQueries({ queryKey: ['course_versions', courseId] }),
    ]);
  } });
  const status = useMutation({ mutationFn: async (op: { commandId: string; expectedDigest: string }) => {
    const { data, error } = await supabase.rpc('get_native_learning_provider_status', { p_command_id: op.commandId, p_expected_digest: op.expectedDigest });
    if (error) throw error;
    if (!validProviderStatus(data) || data.preview.commandId !== op.commandId || data.preview.previewDigest !== op.expectedDigest || data.preview.courseId !== courseId) throw new Error('Provider receipt did not match this course.');
    return data;
  } });
  return { context, commands, preview, apply, status };
}

/** Blank strings from an empty form field are stored as NULL, not as "". */
export function nullableField(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
