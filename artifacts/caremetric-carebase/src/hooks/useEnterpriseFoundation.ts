import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { BillingSessionError } from "@/lib/billingErrors";

export type EnterpriseJson =
  | null
  | boolean
  | number
  | string
  | EnterpriseJson[]
  | { [key: string]: EnterpriseJson };

export type EnterpriseRecord = Record<string, EnterpriseJson>;

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

interface UntypedEnterpriseClient {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
  from: (name: string) => {
    insert: (values: Record<string, unknown>) => {
      select: () => {
        single: () => PromiseLike<RpcResult>;
      };
    };
  };
}

const enterpriseClient = supabase as unknown as UntypedEnterpriseClient;

function asRecord(value: unknown): EnterpriseRecord {
  if (Array.isArray(value)) {
    if (value.length === 1 && value[0] && typeof value[0] === "object" && !Array.isArray(value[0])) {
      return value[0] as EnterpriseRecord;
    }
    return { rowCount: value.length, rows: value as EnterpriseJson[] };
  }
  if (!value || typeof value !== "object") return {};
  return value as EnterpriseRecord;
}

async function callJsonRpc(
  name: string,
  args?: Record<string, unknown>,
): Promise<EnterpriseRecord> {
  const { data, error } = await enterpriseClient.rpc(name, args);
  if (error) throw new Error(error.message);
  return asRecord(data);
}

export interface EnterpriseFoundationSnapshot {
  scope: EnterpriseRecord;
  workforce: EnterpriseRecord;
  rules: EnterpriseRecord;
  identity: EnterpriseRecord;
  billing: EnterpriseRecord;
  integrations: EnterpriseRecord;
  operations: EnterpriseRecord;
  setup: EnterpriseRecord;
  collectedAt: string;
}

export function useEnterpriseFoundation() {
  return useQuery({
    queryKey: ["enterprise-foundation"],
    queryFn: async (): Promise<EnterpriseFoundationSnapshot> => {
      const [scope, workforce, rules, identity, billing, integrations, operations, setup] =
        await Promise.all([
          callJsonRpc("get_enterprise_scope_control_plane"),
          callJsonRpc("get_workforce_compliance_control_plane"),
          callJsonRpc("get_regulatory_rule_control_plane"),
          callJsonRpc("get_identity_control_plane"),
          callJsonRpc("get_billing_reconciliation", {
            p_organization_id: null,
          }),
          callJsonRpc("get_integration_control_plane", {
            p_organization_id: null,
          }),
          callJsonRpc("get_enterprise_operations_control_plane", {
            p_organization_id: null,
            p_facility_id: null,
          }),
          callJsonRpc("get_guided_org_setup_status", {
            p_organization_id: null,
          }),
        ]);

      return {
        scope,
        workforce,
        rules,
        identity,
        billing,
        integrations,
        operations,
        setup,
        collectedAt: new Date().toISOString(),
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useSaveEnterpriseSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await enterpriseClient.rpc("save_enterprise_analytics_snapshot", {
        p_organization_id: null,
        p_facility_id: null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["enterprise-foundation"] });
    },
  });
}

export interface EnterpriseRpcCommand {
  rpc: string;
  args: Record<string, unknown>;
}

export function useEnterpriseRpcCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rpc, args }: EnterpriseRpcCommand) => {
      const { data, error } = await enterpriseClient.rpc(rpc, args);
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["enterprise-foundation"],
      });
    },
  });
}

export function useEnterpriseTableInsert(table: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const { data, error } = await enterpriseClient.from(table).insert(values).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["enterprise-foundation"] });
    },
  });
}

export interface BillingSessionRequest {
  organizationId: string;
  action: "checkout" | "portal";
  packageId?: string;
  billingInterval?: "month" | "year";
  quantity?: number;
  seatQuantity?: number;
  successUrl?: string;
  cancelUrl?: string;
  returnUrl?: string;
  idempotencyKey?: string;
}

export interface BillingSessionResponse {
  data: {
    kind: "checkout" | "portal";
    sessionId: string;
    url: string;
    checkoutConfiguration?: {
      billingMetric: string;
      billingInterval: "month" | "year";
      quantity: number;
    } | null;
    expiresAt?: string;
  };
  meta: {
    requestId: string;
    correlationId: string;
    stripeApiVersion: string;
  };
}

export function useCreateBillingSession() {
  return useMutation({
    mutationFn: async (
      request: BillingSessionRequest,
    ): Promise<BillingSessionResponse> => {
      const { data, error } = await supabase.functions.invoke(
        "create-billing-session",
        { body: request },
      );
      if (error) {
        // The edge function answers structured { error: { code } } bodies
        // (aal2_required, existing_subscription_requires_portal, ...) that the
        // generic FunctionsHttpError message discards. Same parse pattern as
        // Employees.tsx bulk import.
        if (error instanceof FunctionsHttpError) {
          let code: string | null = null;
          try {
            const body = (await error.context.json()) as { error?: { code?: unknown } } | null;
            if (typeof body?.error?.code === "string") code = body.error.code;
          } catch {
            // Response body wasn't JSON -- keep the generic message below.
          }
          throw new BillingSessionError(code, error.message);
        }
        throw error;
      }
      return data as BillingSessionResponse;
    },
  });
}
