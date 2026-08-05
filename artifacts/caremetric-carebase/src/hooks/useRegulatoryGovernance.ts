/**
 * Reading a rule as it stood, and resolving what a shadow run disagreed about
 * (BACKLOG.md G15.17, G15.19).
 *
 * Four functions in this family had no caller. Two of them are human decisions and are wired here;
 * the other two -- `record_regulatory_shadow_run` and `record_regulatory_fixture_result` -- take an
 * engine version, an evaluated count and a request id, which is machine output from a rule engine
 * or a conformance harness rather than anything a person types. Those stay recorded rather than
 * given a form nobody would use.
 *
 * `get_regulatory_rule_snapshot` is the one worth having in the product: it answers "what did this
 * rule say on the day this happened", which is the question every retrospective compliance argument
 * turns on, and which no column can answer once a rule has been superseded.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }
const rpcClient = supabase as unknown as RpcClient;

export interface RegulatoryRuleSnapshot {
  rule_version_id: string;
  version_number: number;
  jurisdiction_code: string;
  authority_name: string;
  citation: string;
  source_uri: string | null;
  source_checksum_sha256: string | null;
  applicability: unknown;
  [key: string]: unknown;
}

export function useRegulatoryRuleSnapshot(ruleKey: string, asOf: string, enabled: boolean) {
  return useQuery({
    queryKey: ["regulatory-rule-snapshot", ruleKey, asOf],
    enabled: enabled && !!ruleKey && !!asOf,
    queryFn: async () => {
      const { data, error } = await rpcClient.rpc("get_regulatory_rule_snapshot", {
        p_rule_key: ruleKey,
        p_as_of: asOf,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as RegulatoryRuleSnapshot[];
      // A rule with no version effective on that date is a real answer, not an error.
      return rows[0] ?? null;
    },
  });
}

export interface ShadowDifference {
  id: string;
  shadow_run_id: string;
  subject_reference: string;
  baseline_result: unknown;
  candidate_result: unknown;
  difference_checksum_sha256: string;
  created_at: string;
}

export function useShadowDifferences() {
  return useQuery({
    queryKey: ["regulatory-shadow-differences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("regulatory_rule_shadow_differences")
        .select("id,shadow_run_id,subject_reference,baseline_result,candidate_result,difference_checksum_sha256,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ShadowDifference[];
    },
  });
}

/**
 * Verbatim from the CHECK on `regulatory_rule_shadow_reconciliations`. Read out of the constraint
 * rather than invented: a first guess at these was three plausible words the server rejects.
 */
export const SHADOW_RESOLUTIONS = [
  { value: "expected_change", label: "Expected — the candidate is meant to differ here" },
  { value: "baseline_defect", label: "The current rule is wrong" },
  { value: "candidate_defect", label: "The candidate rule is wrong" },
] as const;

/** Also from the constraints: a rationale under ten characters and a non-hex checksum are refused. */
export const SHADOW_RATIONALE_MIN = 10;

export function useReconcileShadowDifference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      differenceId: string;
      resolution: string;
      rationale: string;
      evidenceChecksumSha256: string;
    }) => {
      const { data, error } = await rpcClient.rpc("reconcile_regulatory_shadow_difference", {
        p_difference_id: input.differenceId,
        p_resolution: input.resolution,
        p_rationale: input.rationale,
        p_evidence_checksum_sha256: input.evidenceChecksumSha256,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["regulatory-shadow-differences"] }),
  });
}
