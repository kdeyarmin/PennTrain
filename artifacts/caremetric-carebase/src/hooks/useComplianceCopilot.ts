import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ComplianceCopilotRun = Tables<"compliance_copilot_runs">;
export type CopilotIntent =
  | "employee_blocked"
  | "due_next_30_days"
  | "missing_medical_evaluations"
  | "citation_evidence"
  | "recurring_citations"
  | "readiness_score"
  | "draft_plan_of_correction"
  | "mock_survey_request"
  | "overdue_support_plans"
  | "effectiveness_reviews";

export interface CopilotRuleSource {
  id: string;
  rulePackId: string;
  ruleKey: string;
  rulePackName: string;
  versionId: string;
  versionNumber: number;
  jurisdictionCode: string;
  authorityName: string;
  citation: string;
  sourceUri: string | null;
  sourceChecksumSha256: string;
  contentChecksumSha256: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  applicability: Record<string, unknown>;
}

export interface CopilotEvidence {
  id: string;
  type: string;
  label: string;
  status: string | null;
  occurredOn: string | null;
  dueOn: string | null;
  route: string;
  details: Record<string, unknown>;
}

export interface CopilotResponse {
  answer: string;
  findings: Array<{ title: string; detail: string; evidence_ids: string[] }>;
  source_ids: string[];
  evidence_ids: string[];
  missing_information: string[];
  recommended_next_steps: string[];
}

export interface CopilotResult {
  runId: string;
  createdAt: string;
  intent: CopilotIntent;
  determinationKind: "recommendation" | "confirmed_system_determination";
  jurisdictionCode: string;
  facilityType: string;
  asOfDate: string;
  model: string;
  response: CopilotResponse;
  ruleSources: CopilotRuleSource[];
  evidenceUsed: CopilotEvidence[];
  safeguards: {
    readOnly: boolean;
    humanConfirmationRequired: boolean;
    prohibitedActions: string[];
  };
}

export interface AskCopilotInput {
  facilityId: string;
  intent: CopilotIntent;
  question: string;
  employeeId?: string;
  violationId?: string;
  citationQuery?: string;
  asOfDate?: string;
}

export function useComplianceCopilotHistory(facilityId: string | undefined) {
  return useQuery({
    queryKey: ["compliance-copilot-runs", facilityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_copilot_runs")
        .select("*")
        .eq("facility_id", facilityId!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
    enabled: Boolean(facilityId),
  });
}

export function useAskComplianceCopilot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AskCopilotInput) => {
      const { data, error } = await supabase.functions.invoke("compliance-copilot", { body: input });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as CopilotResult;
    },
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: ["compliance-copilot-runs", input.facilityId] }),
  });
}
