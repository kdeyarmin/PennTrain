import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type PolicyAttestationCampaign = Tables<"policy_attestation_campaigns">;
export type PolicyAttestationCampaignInsert = TablesInsert<"policy_attestation_campaigns">;
export type PolicyAttestation = Tables<"policy_attestations">;

export interface ListPolicyAttestationCampaignsFilters {
  organizationId?: string;
  policyDocumentId?: string;
}

export function useListPolicyAttestationCampaigns(filters: ListPolicyAttestationCampaignsFilters = {}) {
  return useQuery({
    queryKey: ["policy_attestation_campaigns", filters],
    queryFn: async () => {
      let query = supabase.from("policy_attestation_campaigns").select("*").order("created_at", { ascending: false });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.policyDocumentId) query = query.eq("policy_document_id", filters.policyDocumentId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePolicyAttestationCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PolicyAttestationCampaignInsert) => {
      const { data, error } = await supabase.from("policy_attestation_campaigns").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policy_attestation_campaigns"] }),
  });
}

// ---------------------------------------------------------------------------
// Per-employee attestation rows.
//
// Assigning a campaign to a roster fans out the same two-level way
// useApplyTrainingPlanToEmployee/TrainingPlans.tsx already does: this hook
// creates ONE attestation for ONE employee; the calling page (PolicyDocuments
// campaign dialog) loops selected employees with Promise.allSettled. There's
// no per-employee "multiple items" level here (a campaign is exactly one
// policy version), so the hook itself needs no inner fan-out loop.
//
// organization_id/facility_id are supplied by the caller (same convention as
// useCreateEmployeeCredential's call site: the calling page reads them off the
// selected employee record) -- stamp_scope_from_employee_for_attestation()
// (BEFORE INSERT trigger) then unconditionally re-derives both from
// employee_id and overwrites whatever was passed, so a caller can't put an
// attestation in the wrong org/facility even if it got these wrong.
//
// The same trigger also sets due_date from the campaign, unconditionally. `dueDate` below is
// therefore advisory: PolicyDocumentDetail passes the campaign's own due date, so it agrees, but
// there is no way to give one employee a different deadline through this path -- a per-employee
// due date would need the trigger to stop overwriting it.
// ---------------------------------------------------------------------------

export interface ListPolicyAttestationsFilters {
  campaignId?: string;
  employeeId?: string;
  status?: PolicyAttestation["status"];
}

// `options.enabled` matters for callers that intend to scope by employeeId but don't have one yet
// (e.g. an employee self-service page before its employees row has resolved) -- every filter field
// here is applied only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes
// to "no filter at all," silently returning every attestation RLS permits. Passing `enabled: false`
// in that case (rather than `employeeId: undefined`) is the only way to get "no results yet"
// instead of firing twice (once unscoped, once scoped) on every page load. Mirrors
// useCourseAssignments.ts's useListCourseAssignments. Defaults to `undefined`, which react-query
// treats as "always enabled," so every existing caller that doesn't pass `options` is unaffected.
export function useListPolicyAttestations(filters: ListPolicyAttestationsFilters = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["policy_attestations", filters],
    queryFn: async () => {
      let query = supabase.from("policy_attestations").select("*").order("due_date", { ascending: true, nullsFirst: false });
      if (filters.campaignId) query = query.eq("campaign_id", filters.campaignId);
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: options.enabled,
  });
}

export interface AssignPolicyAttestationParams {
  campaignId: string;
  employeeId: string;
  organizationId: string;
  facilityId: string;
  policyDocumentVersionId: string;
  dueDate?: string | null;
}

export function useAssignPolicyAttestationToEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: AssignPolicyAttestationParams) => {
      const { data, error } = await supabase
        .from("policy_attestations")
        .insert({
          campaign_id: params.campaignId,
          employee_id: params.employeeId,
          organization_id: params.organizationId,
          facility_id: params.facilityId,
          policy_document_version_id: params.policyDocumentVersionId,
          due_date: params.dueDate ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["policy_attestations"] });
      queryClient.invalidateQueries({ queryKey: ["policy_attestation_campaigns", data.campaign_id] });
    },
  });
}

// ---------------------------------------------------------------------------
// Knowledge checks (BACKLOG.md E4).
//
// Two deliberately separate read paths, because they are for two different
// people. Administrators authoring a campaign read policy_campaign_questions
// directly (RLS lets org_admin/facility_manager see the whole row, answer key
// included). Employees never touch that table -- they go through
// get_policy_knowledge_check, whose return type has no correct_choice_index at
// all, so the answer key cannot reach a learner's browser even by mistake.
// ---------------------------------------------------------------------------

export type PolicyCampaignQuestion = Tables<"policy_campaign_questions">;
export type PolicyCampaignQuestionInsert = TablesInsert<"policy_campaign_questions">;

/** Admin-side read: includes the answer key, and is RLS-restricted to campaign authors. */
export function useListCampaignQuestions(campaignId: string | undefined) {
  return useQuery({
    queryKey: ["policy_campaign_questions", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policy_campaign_questions")
        .select("*")
        .eq("campaign_id", campaignId!)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!campaignId,
  });
}

export function useCreateCampaignQuestions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (questions: PolicyCampaignQuestionInsert[]) => {
      if (questions.length === 0) return [];
      const { data, error } = await supabase.from("policy_campaign_questions").insert(questions).select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policy_campaign_questions"] }),
  });
}

export interface CampaignTargeting {
  /** `manual` keeps the pre-E4 behaviour: the campaign fans out only to explicitly picked employees. */
  mode: "manual" | "declarative";
  /** Named facilities. `null` means every facility in the organization, not "none". */
  facilityIds: string[] | null;
  facilityType: "PCH" | "ALR" | null;
  workerType: "regular" | "agency" | "substitute" | "volunteer" | null;
  /** ILIKE pattern against employees.job_title, the dimension compliance rules already match on. */
  jobTitlePattern: string | null;
}

export interface CreateCampaignWithQuestionsParams {
  organizationId: string;
  policyDocumentId: string;
  policyDocumentVersionId: string;
  name: string;
  dueDate: string | null;
  questions: Array<{ prompt: string; choices: string[]; correct_choice_index: number }>;
  /** Omit for a manual campaign -- the RPC defaults every targeting parameter. */
  targeting?: CampaignTargeting;
}

/**
 * Creates a campaign and its questions in ONE transaction.
 *
 * Replaces an earlier create-campaign-then-insert-questions sequence: if the second call failed,
 * the campaign stayed committed looking exactly like a read-and-sign campaign, and assigning it let
 * staff attest with no knowledge check and no signal to the author. The RPC is SECURITY INVOKER, so
 * both tables' RLS policies still authorize the caller exactly as a direct insert would.
 */
export function useCreatePolicyCampaignWithQuestions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: CreateCampaignWithQuestionsParams) => {
      const { data, error } = await supabase.rpc("create_policy_campaign_with_questions", {
        p_organization_id: params.organizationId,
        p_policy_document_id: params.policyDocumentId,
        p_policy_document_version_id: params.policyDocumentVersionId,
        p_name: params.name,
        p_due_date: params.dueDate ?? undefined,
        p_questions: params.questions,
        // A declarative campaign enrols its initial roster inside the same RPC call, so the
        // administrator sees assignments immediately rather than after the nightly sweep.
        p_targeting_mode: params.targeting?.mode ?? "manual",
        p_target_facility_ids: params.targeting?.facilityIds ?? undefined,
        p_target_facility_type: params.targeting?.facilityType ?? undefined,
        p_target_worker_type: params.targeting?.workerType ?? undefined,
        p_target_job_title_pattern: params.targeting?.jobTitlePattern ?? undefined,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policy_attestation_campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["policy_campaign_questions"] });
      // A declarative campaign creates attestations as part of creation, so the roster view is
      // stale the moment this resolves.
      queryClient.invalidateQueries({ queryKey: ["policy_attestations"] });
    },
  });
}

export interface KnowledgeCheckQuestion {
  question_id: string;
  display_order: number;
  prompt: string;
  choices: string[];
}

/** Employee-side read: the same questions, minus the answer key. */
export function usePolicyKnowledgeCheck(attestationId: string | undefined) {
  return useQuery({
    queryKey: ["policy_knowledge_check", attestationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_policy_knowledge_check", {
        p_attestation_id: attestationId!,
      });
      if (error) throw error;
      return (data ?? []) as unknown as KnowledgeCheckQuestion[];
    },
    enabled: !!attestationId,
  });
}

/**
 * Whether this attestation already has a passing attempt on record.
 *
 * Without this, closing the dialog after passing but before attesting loses the fact: reopening
 * would re-disable the attest button and demand a full retake, adding a duplicate attempt for a
 * check the server already considers passed. RLS scopes policy_knowledge_check_attempts to the
 * owning employee, so this is the learner reading their own record.
 */
export function useHasPassedKnowledgeCheck(attestationId: string | undefined) {
  return useQuery({
    queryKey: ["policy_knowledge_check_passed", attestationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policy_knowledge_check_attempts")
        .select("id")
        .eq("attestation_id", attestationId!)
        .eq("passed", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    enabled: !!attestationId,
  });
}

export interface KnowledgeCheckResult {
  attemptId: string;
  passed: boolean;
  correctCount: number;
  totalCount: number;
}

// Grading happens entirely in submit_policy_knowledge_check -- this sends the chosen indexes and
// reports back the score. It deliberately does not learn which individual answers were wrong;
// repeated attempts would otherwise reconstruct the answer key without reading the policy.
export function useSubmitPolicyKnowledgeCheck() {
  return useMutation({
    mutationFn: async (params: { attestationId: string; answers: Record<string, number> }) => {
      const { data, error } = await supabase.rpc("submit_policy_knowledge_check", {
        p_attestation_id: params.attestationId,
        p_answers: params.answers,
      });
      if (error) throw error;
      return data as unknown as KnowledgeCheckResult;
    },
    // Deliberately no invalidation. Nothing in the app caches attempts, and the questions
    // (["policy_knowledge_check", attestationId]) do not change when one is graded -- refetching
    // them would only re-request the same rows. The result is returned to the caller directly.
  });
}

interface AttestPolicyResponse {
  success?: boolean;
  error?: string;
  attestation?: { id: string; status: string; attested_at: string };
}

// Routes through the attest-policy Edge Function rather than a plain RPC/table update -- there
// is deliberately no "update" RLS policy on policy_attestations for authenticated users, so this
// is the only way an attestation can move from pending to attested. The function captures IP/
// User-Agent from the request itself (unavailable to a plain Postgres RPC), which is what makes
// the resulting row an ESIGN/UETA-adequate record of intent, consent, and attribution.
export function useAttestPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (attestationId: string) => {
      const { data, error } = await supabase.functions.invoke<AttestPolicyResponse>("attest-policy", {
        body: { attestationId },
      });
      if (error) throw error;
      if (!data || data.success === false || !data.attestation) {
        throw new Error(data?.error ?? "Failed to record attestation");
      }
      return data.attestation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policy_attestations"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
