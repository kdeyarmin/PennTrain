import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import type { PaginatedResult } from "@/lib/dataTable";

export type WorkItem = Tables<"work_items">;
export type WorkItemTemplate = Tables<"work_item_templates">;
export type WorkItemHistory = Tables<"work_item_history">;
export type WorkItemComment = Tables<"work_item_comments">;
export type WorkItemWatcher = Tables<"work_item_watchers">;
export type WorkItemEvidence = Tables<"work_item_evidence">;

export interface WorkItemWithRelations extends WorkItem {
  facility: { id: string; name: string } | null;
  owner: { id: string; first_name: string; last_name: string } | null;
  template: Pick<
    WorkItemTemplate,
    "id" | "name" | "approval_required" | "required_evidence_types"
  > | null;
}

export interface WorkItemDependency extends Tables<"work_item_dependencies"> {
  dependency: Pick<WorkItem, "id" | "title" | "state" | "due_at" | "priority"> | null;
}

export interface WorkItemCommentWithAuthor extends WorkItemComment {
  author: { id: string; first_name: string; last_name: string } | null;
}

export interface WorkItemHistoryWithActor extends WorkItemHistory {
  actor: { id: string; first_name: string; last_name: string } | null;
}

export interface WorkItemWatcherWithProfile extends WorkItemWatcher {
  profile: { id: string; first_name: string; last_name: string } | null;
}

export interface ListWorkItemsFilters {
  organizationId?: string;
  facilityId?: string;
  ownerProfileId?: string;
  state?: string;
  priority?: string;
  sourceType?: string;
  dueBefore?: string;
  dueAfter?: string;
}

const WORK_ITEM_SELECT = `
  *,
  facility:facilities(id, name),
  owner:profiles!work_items_owner_profile_id_fkey(id, first_name, last_name),
  template:work_item_templates(id, name, approval_required, required_evidence_types)
`;

function invalidateWorkItems(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
  queryClient.invalidateQueries({ queryKey: ["closed-loop-compliance"] });
}

export function useListWorkItems(filters: ListWorkItemsFilters = {}) {
  return useQuery({
    queryKey: ["work-items", "list", filters],
    queryFn: async () => {
      let query = supabase
        .from("work_items")
        .select(WORK_ITEM_SELECT)
        .order("due_at", { ascending: true });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.ownerProfileId) query = query.eq("owner_profile_id", filters.ownerProfileId);
      if (filters.state) query = query.eq("state", filters.state);
      if (filters.priority) query = query.eq("priority", filters.priority);
      if (filters.sourceType) query = query.eq("source_type", filters.sourceType);
      if (filters.dueBefore) query = query.lte("due_at", filters.dueBefore);
      if (filters.dueAfter) query = query.gte("due_at", filters.dueAfter);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as WorkItemWithRelations[];
    },
  });
}

export interface PaginatedWorkItemsFilters {
  organizationId?: string;
  facilityId?: string;
  ownerProfileId?: string;
  ownerId?: string;
  state?: string;
  activeOnly?: boolean;
  priority?: string;
  sourceType?: string;
  search?: string;
  /** The single "now" the tiles and the list share, so their overdue math agrees. */
  now: string;
  overdueOnly?: boolean;
  /** Upper bound for the "due within N days" windows; already computed against `now`. */
  dueBefore?: string;
  page: number;
  pageSize: number;
}

// Server-side paginated, server-sorted work queue. The queue's overdue-first + priority + due_at
// ordering depends on "now" and an enum rank, so it can't be a PostgREST .order() -- get_work_item_queue
// computes it in SQL and returns one page plus the total match count, keeping the facility/owner/template
// embeds the list renders. Mirrors the sortWorkItems() ordering exactly.
export function usePaginatedWorkItems(filters: PaginatedWorkItemsFilters) {
  return useQuery({
    queryKey: ["work-items", "queue", filters],
    queryFn: async (): Promise<PaginatedResult<WorkItemWithRelations>> => {
      const { data, error } = await supabase.rpc("get_work_item_queue", {
        p_organization_id: filters.organizationId,
        p_facility_id: filters.facilityId,
        p_owner_profile_id: filters.ownerProfileId,
        p_owner_id: filters.ownerId,
        p_state: filters.state,
        p_active_only: filters.activeOnly ?? false,
        p_priority: filters.priority,
        p_source_type: filters.sourceType,
        p_search: filters.search,
        p_now: filters.now,
        p_overdue_only: filters.overdueOnly ?? false,
        p_due_before: filters.dueBefore,
        p_limit: filters.pageSize,
        p_offset: (filters.page - 1) * filters.pageSize,
      });
      if (error) throw error;
      const payload = (data ?? { rows: [], count: 0 }) as unknown as {
        rows: WorkItemWithRelations[];
        count: number;
      };
      return { rows: payload.rows ?? [], count: payload.count ?? 0 };
    },
    placeholderData: (previous) => previous,
  });
}

export function useGetWorkItem(id: string | undefined) {
  return useQuery({
    queryKey: ["work-items", "detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select(WORK_ITEM_SELECT)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as WorkItemWithRelations;
    },
    enabled: !!id,
  });
}

export function useWorkItemActivity(id: string | undefined) {
  return useQuery({
    queryKey: ["work-items", "activity", id],
    queryFn: async () => {
      const [history, comments, watchers, evidence, dependencies] = await Promise.all([
        supabase
          .from("work_item_history")
          .select("*, actor:profiles!work_item_history_actor_profile_id_fkey(id, first_name, last_name)")
          .eq("work_item_id", id!)
          .order("occurred_at", { ascending: false }),
        supabase
          .from("work_item_comments")
          .select("*, author:profiles!work_item_comments_author_profile_id_fkey(id, first_name, last_name)")
          .eq("work_item_id", id!)
          .order("created_at", { ascending: false }),
        supabase
          .from("work_item_watchers")
          .select("*, profile:profiles!work_item_watchers_profile_id_fkey(id, first_name, last_name)")
          .eq("work_item_id", id!)
          .order("created_at", { ascending: true }),
        supabase
          .from("work_item_evidence")
          .select("*")
          .eq("work_item_id", id!)
          .order("created_at", { ascending: false }),
        supabase
          .from("work_item_dependencies")
          .select(`
            *,
            dependency:work_items!work_item_dependencies_depends_on_work_item_id_fkey(
              id, title, state, due_at, priority
            )
          `)
          .eq("work_item_id", id!)
          .order("created_at", { ascending: true }),
      ]);
      const firstError = [history, comments, watchers, evidence, dependencies].find(result => result.error)?.error;
      if (firstError) throw firstError;
      return {
        history: (history.data ?? []) as unknown as WorkItemHistoryWithActor[],
        comments: (comments.data ?? []) as unknown as WorkItemCommentWithAuthor[],
        watchers: (watchers.data ?? []) as unknown as WorkItemWatcherWithProfile[],
        evidence: evidence.data ?? [],
        dependencies: (dependencies.data ?? []) as unknown as WorkItemDependency[],
      };
    },
    enabled: !!id,
  });
}

export function useTransitionWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workItemId,
      targetState,
      reason,
    }: {
      workItemId: string;
      targetState: string;
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("transition_work_item", {
        p_work_item_id: workItemId,
        p_target_state: targetState,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateWorkItems(queryClient),
  });
}

export function useApproveWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workItemId, reason }: { workItemId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("approve_work_item" as never, {
        p_work_item_id: workItemId,
        p_reason: reason,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateWorkItems(queryClient),
  });
}

export function useUpdateWorkItemAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workItemId,
      ownerProfileId,
      priority,
      dueAt,
    }: {
      workItemId: string;
      ownerProfileId: string | null;
      priority: string;
      dueAt: string;
    }) => {
      const { data, error } = await supabase.rpc("update_work_item_assignment" as never, {
        p_work_item_id: workItemId,
        p_owner_profile_id: ownerProfileId,
        p_priority: priority,
        p_due_at: dueAt,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateWorkItems(queryClient),
  });
}

export function useAddWorkItemComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workItemId, body }: { workItemId: string; body: string }) => {
      const { data, error } = await supabase.rpc("add_work_item_comment" as never, {
        p_work_item_id: workItemId,
        p_body: body,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-items", "activity"] }),
  });
}

export function useSetWorkItemWatching() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workItemId, watching }: { workItemId: string; watching: boolean }) => {
      const { data, error } = await supabase.rpc("set_work_item_watching" as never, {
        p_work_item_id: workItemId,
        p_watching: watching,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-items", "activity"] }),
  });
}

export function useAddWorkItemDependency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workItemId,
      dependsOnWorkItemId,
      dependencyType,
    }: {
      workItemId: string;
      dependsOnWorkItemId: string;
      dependencyType: string;
    }) => {
      const { data, error } = await supabase.rpc("add_work_item_dependency" as never, {
        p_work_item_id: workItemId,
        p_depends_on_work_item_id: dependsOnWorkItemId,
        p_dependency_type: dependencyType,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateWorkItems(queryClient),
  });
}

export function useRemoveWorkItemDependency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dependencyId: string) => {
      const { data, error } = await supabase.rpc("remove_work_item_dependency" as never, {
        p_dependency_id: dependencyId,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateWorkItems(queryClient),
  });
}

export function useSubmitLinkedWorkItemEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workItemId,
      evidenceType,
      linkedRecordType,
      linkedRecordId,
    }: {
      workItemId: string;
      evidenceType: string;
      linkedRecordType: string;
      linkedRecordId: string;
    }) => {
      const { data, error } = await supabase.rpc("submit_work_item_evidence" as never, {
        p_work_item_id: workItemId,
        p_evidence_type: evidenceType,
        p_storage_bucket: null,
        p_storage_path: null,
        p_linked_record_type: linkedRecordType,
        p_linked_record_id: linkedRecordId,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-items"] }),
  });
}

export function useUploadWorkItemEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workItem,
      evidenceType,
      file,
    }: {
      workItem: WorkItem;
      evidenceType: string;
      file: File;
    }) => {
      const path = `${workItem.organization_id}/${workItem.facility_id}/${workItem.id}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("work-item-evidence").upload(path, file);
      if (uploadError) throw uploadError;
      const { data, error } = await supabase.rpc("submit_work_item_evidence" as never, {
        p_work_item_id: workItem.id,
        p_evidence_type: evidenceType,
        p_storage_bucket: "work-item-evidence",
        p_storage_path: path,
        p_linked_record_type: null,
        p_linked_record_id: null,
      } as never);
      if (error) {
        await supabase.storage.from("work-item-evidence").remove([path]);
        throw error;
      }
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-items"] }),
  });
}

export function useWorkItemEvidenceUrl() {
  return useMutation({
    mutationFn: async (evidence: WorkItemEvidence) => {
      if (!evidence.storage_bucket || !evidence.storage_path) {
        throw new Error("This evidence links to another record.");
      }
      const { data, error } = await supabase.storage
        .from(evidence.storage_bucket)
        .createSignedUrl(evidence.storage_path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function useRecordWorkItemEffectiveness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workItemId, result }: { workItemId: string; result: string }) => {
      const { data, error } = await supabase.rpc("record_work_item_effectiveness" as never, {
        p_work_item_id: workItemId,
        p_result: result,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateWorkItems(queryClient),
  });
}
