/**
 * Adaptive learning paths (BACKLOG.md G11).
 *
 * `evaluate_learning_path` was the only granted function in this area and it had no caller, because
 * nothing anywhere wrote `learning_path_definitions`, `learning_path_versions` or
 * `learning_path_assignments` -- no RPC, no edge function, no trigger, no seed. Migration
 * `20260804140000` supplies the authoring, publication and assignment path; this module reads it and
 * drives all four.
 *
 * Reads go at the tables: all four carry `grant select` to `authenticated` with RLS scoping rows to
 * the caller's organization, or to the employee whose assignment it is.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import type { PathDefinition } from "@/lib/learningPaths";

export type LearningPathDefinition = Tables<"learning_path_definitions">;
export type LearningPathVersion = Tables<"learning_path_versions">;
export type LearningPathAssignment = Tables<"learning_path_assignments">;

const PATH_KEY = ["learning-paths"] as const;

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }
const rpcClient = () => supabase as unknown as RpcClient;

export function useLearningPathVersions() {
  return useQuery({
    queryKey: [...PATH_KEY, "versions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learning_path_versions")
        .select("*, definition_row:learning_path_definitions(id, name, description, status)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as (LearningPathVersion & {
        definition_row: { id: string; name: string; description: string | null; status: string } | null;
      })[];
    },
  });
}

export function useLearningPathAssignments(pathVersionId?: string) {
  return useQuery({
    queryKey: [...PATH_KEY, "assignments", pathVersionId ?? "all"],
    queryFn: async () => {
      let query = supabase
        .from("learning_path_assignments")
        .select("*, employee:employees(id, first_name, last_name)")
        .order("assigned_at", { ascending: false });
      if (pathVersionId) query = query.eq("path_version_id", pathVersionId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as (LearningPathAssignment & {
        employee: { id: string; first_name: string; last_name: string } | null;
      })[];
    },
  });
}

function useLearningPathMutation<TArgs, TResult>(run: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PATH_KEY }),
        // The Adaptive tab's counters read the same rows.
        queryClient.invalidateQueries({ queryKey: ["governed-learning"] }),
      ]);
    },
  });
}

export function useSaveLearningPathVersion() {
  return useLearningPathMutation(async (input: {
    name: string;
    definition: PathDefinition;
    description?: string;
    pathDefinitionId?: string | null;
    versionId?: string | null;
  }) => {
    const { data, error } = await rpcClient().rpc("save_learning_path_version", {
      p_name: input.name,
      p_definition: input.definition,
      p_description: input.description ?? null,
      // Null on both creates a fresh path and its first draft; supplying the definition alone adds
      // a new draft version to an existing path.
      p_path_definition_id: input.pathDefinitionId ?? null,
      p_version_id: input.versionId ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  });
}

export function usePublishLearningPathVersion() {
  return useLearningPathMutation(async (input: { versionId: string }) => {
    const { data, error } = await rpcClient().rpc("publish_learning_path_version", {
      p_version_id: input.versionId,
    });
    if (error) throw new Error(error.message);
    return data as string;
  });
}

export function useAssignLearningPath() {
  return useLearningPathMutation(async (input: {
    employeeId: string;
    pathVersionId: string;
    dueAt?: string | null;
  }) => {
    const { data, error } = await rpcClient().rpc("assign_learning_path", {
      p_employee_id: input.employeeId,
      p_path_version_id: input.pathVersionId,
      p_due_at: input.dueAt ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  });
}

export interface PathEvaluation {
  stateVersion: number;
  steps: Record<string, { state: string; reason: string; explanation: string }>;
}

/**
 * Advance an assignment against a set of outcomes.
 *
 * `p_expected_state_version` is optimistic concurrency, not a formality: the server raises 55000 if
 * it does not match, which is what stops two people evaluating the same assignment from writing
 * contradictory transition events. It is read from the assignment rather than counted client-side.
 */
export function useEvaluateLearningPath() {
  return useLearningPathMutation(async (input: {
    assignmentId: string;
    expectedStateVersion: number;
    outcomes: Record<string, { completed?: boolean; score?: number }>;
  }) => {
    const { data, error } = await rpcClient().rpc("evaluate_learning_path", {
      p_path_assignment_id: input.assignmentId,
      p_expected_state_version: input.expectedStateVersion,
      p_outcomes: input.outcomes,
    });
    if (error) throw new Error(error.message);
    return data as PathEvaluation;
  });
}
