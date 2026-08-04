/**
 * Reads and commands for the governed publication control (BACKLOG.md G10).
 *
 * `useGovernedLearning.ts` keeps the aggregate counters and the generic command dispatcher it always
 * had. This module is the part that was missing: the actual assets and revisions behind those
 * counters, and typed mutations for the three lifecycle steps that had no caller.
 *
 * Reads go straight at the tables. Both carry `grant select` to `authenticated` plus an RLS policy
 * scoping rows to the caller's organization, so there is nothing an RPC would add here -- and the
 * page needs the rows themselves, not another count.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import type { CourseSnapshot, ValidationFinding } from "@/lib/governedContentRevision";

export type GovernedContentAsset = Tables<"governed_content_assets">;
export type GovernedContentRevision = Tables<"governed_content_revisions">;

const GOVERNED_KEY = ["governed-content"] as const;

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }
const rpcClient = supabase as unknown as RpcClient;

export function useGovernedContentAssets() {
  return useQuery({
    queryKey: [...GOVERNED_KEY, "assets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("governed_content_assets")
        .select("*")
        .eq("status", "active")
        .order("title");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Revisions for one asset, newest first.
 *
 * Newest first because the only revision anyone acts on is the one still moving; published and
 * superseded ones below it are the audit trail, which is read in the other direction only when
 * somebody is reconstructing history.
 */
export function useGovernedContentRevisions(assetId: string | undefined) {
  return useQuery({
    queryKey: [...GOVERNED_KEY, "revisions", assetId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("governed_content_revisions")
        .select("*")
        .eq("asset_id", assetId!)
        .order("revision_number", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!assetId,
  });
}

function useGovernedMutation<TArgs, TResult>(run: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: GOVERNED_KEY }),
        // The aggregate counters at the top of the page count the same rows.
        queryClient.invalidateQueries({ queryKey: ["governed-learning"] }),
      ]);
    },
  });
}

async function callRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await rpcClient.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export function useRegisterGovernedAsset() {
  return useGovernedMutation(async (input: { courseId: string; title?: string }) =>
    callRpc("register_governed_content_asset", {
      p_asset_type: "course",
      p_source_id: input.courseId,
      p_title: input.title ?? null,
    }) as Promise<string>);
}

export function useCreateGovernedRevision() {
  return useGovernedMutation(async (input: {
    assetId: string;
    sourceVersionId: string;
    changeSummary: string;
    materialChange: boolean;
    materialChangeAction: string;
    snapshot: CourseSnapshot;
  }) =>
    callRpc("create_governed_content_revision", {
      p_asset_id: input.assetId,
      p_source_version_id: input.sourceVersionId,
      p_change_summary: input.changeSummary,
      p_material_change: input.materialChange,
      p_material_change_action: input.materialChangeAction,
      p_snapshot: input.snapshot,
    }) as Promise<string>);
}

export function useSubmitGovernedRevision() {
  return useGovernedMutation(async (input: { revisionId: string; findings: ValidationFinding[] }) =>
    callRpc("submit_governed_content_revision", {
      p_revision_id: input.revisionId,
      // The server refuses the submission if any entry is severity 'error', so the findings are sent
      // as they were computed rather than filtered down to the ones that would pass.
      p_validation_results: input.findings,
    }));
}

export function useReviewGovernedRevision() {
  return useGovernedMutation(async (input: {
    revisionId: string;
    decision: "approve" | "request_changes";
    reason: string;
  }) =>
    callRpc("review_governed_content_revision", {
      p_revision_id: input.revisionId,
      p_decision: input.decision,
      p_reason: input.reason,
    }));
}

export function usePublishGovernedRevision() {
  return useGovernedMutation(async (input: { revisionId: string; reason: string }) =>
    callRpc("publish_governed_content_revision", {
      p_revision_id: input.revisionId,
      p_reason: input.reason,
    }));
}
