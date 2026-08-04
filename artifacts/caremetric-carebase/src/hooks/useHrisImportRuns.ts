/**
 * Starting an HRIS import run (BACKLOG.md G10).
 *
 * The Imports tab could validate a run and apply its next batch, but only against a run ID typed
 * into a text box -- and `create_hris_import_run`, the only thing that mints one, had no caller.
 * Both existing commands were therefore unreachable in practice: nothing in the product produced the
 * ID they required.
 *
 * (Staging the rows themselves is `stage_hris_import_row`, which refuses anybody who is not
 * `service_role` -- that is a trusted adapter's job by design and stays out of the browser. A run
 * created here is the container that adapter fills.)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type HrisSourceSystem = Tables<"hris_source_systems">;
export type HrisImportRun = Tables<"hris_import_runs">;

const HRIS_KEY = ["qualified-workforce", "hris"] as const;

export function useHrisSourceSystems() {
  return useQuery({
    queryKey: [...HRIS_KEY, "sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hris_source_systems")
        .select("*")
        // create_hris_import_run refuses any other status with P0002, so offering them would be
        // offering a button that cannot work.
        .in("status", ["pilot", "active"])
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useHrisImportRuns() {
  return useQuery({
    queryKey: [...HRIS_KEY, "runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hris_import_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }

export function useCreateHrisImportRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourceSystemId: string;
      requestId: string;
      importMode?: "delta" | "full";
      sourceCursor?: string;
      sourceCount?: number;
    }) => {
      const { data, error } = await (supabase as unknown as RpcClient).rpc("create_hris_import_run", {
        p_source_system_id: input.sourceSystemId,
        p_request_id: input.requestId,
        // Null takes the source system's own configured mode rather than silently forcing 'delta'.
        p_import_mode: input.importMode ?? null,
        p_source_cursor: input.sourceCursor?.trim() || null,
        p_source_checksum_sha256: null,
        p_source_count: input.sourceCount ?? null,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: HRIS_KEY }),
        queryClient.invalidateQueries({ queryKey: ["qualified-workforce"] }),
      ]);
    },
  });
}
