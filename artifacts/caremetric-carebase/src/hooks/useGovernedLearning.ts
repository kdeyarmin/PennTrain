import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { EnterpriseRecord } from "@/hooks/useEnterpriseFoundation";

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }
const client = supabase as unknown as RpcClient;
const record = (value: unknown): EnterpriseRecord => value && typeof value === "object" && !Array.isArray(value) ? value as EnterpriseRecord : {};

export function useGovernedLearning() {
  return useQuery({
    queryKey: ["governed-learning"],
    queryFn: async () => {
      const { data, error } = await client.rpc("get_governed_learning_control_plane");
      if (error) throw new Error(error.message);
      const root = record(data);
      return { content: record(root.content), policies: record(root.policies), standards: record(root.standards), adaptive: record(root.adaptive), offline: record(root.offline), generatedAt: typeof root.generatedAt === "string" ? root.generatedAt : null };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useGovernedLearningCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rpc, args }: { rpc: string; args: Record<string, unknown> }) => {
      const { data, error } = await client.rpc(rpc, args);
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["governed-learning"] }); },
  });
}
