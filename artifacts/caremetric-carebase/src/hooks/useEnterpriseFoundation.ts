import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { BillingSessionError } from "@/lib/billingErrors";
import { privilegedFailureMessage } from "@/lib/edgeFunctionErrors";

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
      // Nearly every command routed through here -- domain registration and revocation, SCIM
      // connection creation, session revocation, rule approval and activation, entitlement and
      // billing overrides -- is guarded by assert_identity_assurance, so this is the single place
      // most likely to meet the expired privileged window. Untranslated it read as
      // "A fresh AAL2 session is required for operation session_revocation", which sounds like a
      // step-up and is not one. See privilegedSessionExpired.
      if (error) throw new Error(privilegedFailureMessage(error));
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["enterprise-foundation"],
      });
    },
  });
}

/**
 * One row of `get_organization_identity_domains`.
 *
 * `verification_challenge` is the plaintext DNS TXT value, and it comes back null once the domain
 * is verified -- at that point the record has done its job. It is not a secret: its whole purpose
 * is to sit in public DNS, where what it proves is control of the zone, not knowledge of a value.
 *
 * Declared here rather than taken from the generated types: the generator types every column of a
 * `returns table` as non-null, and four of these are nullable in fact (the challenge on a verified
 * domain, and the whole revocation trio on one that is not revoked).
 */
export interface OrganizationIdentityDomain {
  id: string;
  domain: string;
  verification_status: string;
  verification_challenge: string | null;
  verified_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  created_at: string;
}

/**
 * The organization's identity domains, with the outstanding challenge for any still pending
 * (BACKLOG.md J44).
 *
 * This is what makes a reload survivable. The registration page used to mint the challenge in the
 * browser and send only its SHA-256, so the plaintext existed in React state and nowhere else: a
 * refresh -- or coming back the next morning, which is how DNS propagation actually works -- lost
 * the value the operator had been told to publish, and the only way forward the page offered was
 * to register again, which overwrote the digest and invalidated the record they had already
 * published. `20260906210000` moved minting to the server and stores the plaintext so it can be
 * shown again; reading it back is this hook.
 *
 * Keyed under the enterprise-foundation root so every command routed through
 * `useEnterpriseRpcCommand` -- registration, rotation, revocation -- refreshes it.
 */
export function useOrganizationIdentityDomains(organizationId?: string) {
  return useQuery({
    queryKey: ["enterprise-foundation", "identity-domains", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<OrganizationIdentityDomain[]> => {
      const { data, error } = await enterpriseClient.rpc(
        "get_organization_identity_domains",
        { p_organization_id: organizationId },
      );
      if (error) throw new Error(error.message);
      return (data ?? []) as OrganizationIdentityDomain[];
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
  /** Server resolves quantity from the price metric; clients must not send it. */
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
