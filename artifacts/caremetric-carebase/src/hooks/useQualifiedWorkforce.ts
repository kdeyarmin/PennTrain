import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { EnterpriseJson, EnterpriseRecord } from "@/hooks/useEnterpriseFoundation";

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

interface QualifiedWorkforceClient {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
}

const client = supabase as unknown as QualifiedWorkforceClient;

function asRecord(value: unknown): EnterpriseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as EnterpriseRecord;
}

export interface QualifiedWorkforceSnapshot {
  hris: EnterpriseRecord;
  qualifications: EnterpriseRecord;
  credentialRenewals: EnterpriseRecord;
  instructorLedTraining: EnterpriseRecord;
  scheduling: EnterpriseRecord;
  recentEligibilityDecisions: EnterpriseJson[];
  generatedAt: string | null;
}

export function useQualifiedWorkforce() {
  return useQuery({
    queryKey: ["qualified-workforce"],
    queryFn: async (): Promise<QualifiedWorkforceSnapshot> => {
      const { data, error } = await client.rpc("get_qualified_workforce_control_plane");
      if (error) throw new Error(error.message);
      const record = asRecord(data);
      return {
        hris: asRecord(record.hris),
        qualifications: asRecord(record.qualifications),
        credentialRenewals: asRecord(record.credentialRenewals),
        instructorLedTraining: asRecord(record.instructorLedTraining),
        scheduling: asRecord(record.scheduling),
        recentEligibilityDecisions: Array.isArray(record.recentEligibilityDecisions)
          ? record.recentEligibilityDecisions
          : [],
        generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : null,
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export interface QualifiedWorkforceCommand {
  rpc: string;
  args: Record<string, unknown>;
}

export function useQualifiedWorkforceCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rpc, args }: QualifiedWorkforceCommand) => {
      const { data, error } = await client.rpc(rpc, args);
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qualified-workforce"] });
    },
  });
}
