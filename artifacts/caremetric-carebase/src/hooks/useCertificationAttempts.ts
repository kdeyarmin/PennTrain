import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

/**
 * Observed-competency certification (BACKLOG.md G8).
 *
 * WHAT WAS WRONG. `20260711213000` built this capability in full -- versioned checklists, assessor
 * qualifications, attempts, per-item evidence, and `approve_certification_attempt`, which is a
 * genuinely rigorous decision function. And **nothing anywhere created an attempt or recorded a
 * checklist item**, so the approval function approved rows that could not exist and the whole
 * capability had no entry point. Migration `20260804120000` adds the observation path; these are its
 * client bindings, plus the approval call that had never been made.
 *
 * Reads go straight to the tables: all six carry RLS policies already, so no read RPC was needed.
 */

export type CertificationAttempt = Tables<"certification_attempts">;
export type CertificationAttemptItem = Tables<"certification_attempt_items">;
export type CertificationChecklistItem = Tables<"certification_checklist_items">;
export type CertificationDefinition = Tables<"certification_definitions">;

/** Published, currently-effective checklist versions an observation can be started against. */
export function useAvailableCertificationVersions() {
  return useQuery({
    queryKey: ["certification-versions", "available"],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("certification_definition_versions")
        .select("id, version_number, effective_from, effective_to, certification_definitions(id, name, qualification_key, separation_of_duties)")
        .eq("lifecycle_state", "published")
        .lte("effective_from", nowIso)
        .order("version_number", { ascending: false });
      if (error) throw error;
      // `effective_to` is exclusive and may be null; filtering here rather than in the query keeps
      // the null case readable.
      return (data ?? []).filter((row) => {
        const until = (row as { effective_to: string | null }).effective_to;
        return !until || until > nowIso;
      }) as unknown as {
        id: string;
        version_number: number;
        certification_definitions: {
          id: string; name: string; qualification_key: string; separation_of_duties: boolean;
        } | null;
      }[];
    },
    staleTime: 60_000,
  });
}

export function useEmployeeCertificationAttempts(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["certification-attempts", employeeId],
    enabled: Boolean(employeeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("certification_attempts")
        .select("*, certification_definition_versions(id, version_number, certification_definitions(name))")
        .eq("employee_id", employeeId!)
        .order("observed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as (CertificationAttempt & {
        certification_definition_versions: {
          id: string; version_number: number; certification_definitions: { name: string } | null;
        } | null;
      })[];
    },
  });
}

/** The checklist behind an attempt, with whatever has been recorded against each item so far. */
export function useCertificationChecklist(versionId: string | undefined, attemptId: string | undefined) {
  return useQuery({
    queryKey: ["certification-checklist", versionId, attemptId],
    enabled: Boolean(versionId),
    queryFn: async () => {
      const [items, recorded] = await Promise.all([
        supabase.from("certification_checklist_items")
          .select("*").eq("certification_version_id", versionId!).order("sort_order"),
        attemptId
          ? supabase.from("certification_attempt_items")
            .select("*").eq("certification_attempt_id", attemptId)
          : Promise.resolve({ data: [], error: null } as const),
      ]);
      if (items.error) throw items.error;
      if (recorded.error) throw recorded.error;
      const byItem = new Map(
        (recorded.data ?? []).map((row) => [(row as CertificationAttemptItem).checklist_item_id, row as CertificationAttemptItem]),
      );
      return (items.data ?? []).map((item) => ({
        item: item as CertificationChecklistItem,
        recorded: byItem.get((item as CertificationChecklistItem).id) ?? null,
      }));
    },
  });
}

function useCertificationInvalidation(employeeId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["certification-attempts", employeeId] });
    queryClient.invalidateQueries({ queryKey: ["certification-checklist"] });
    // A passed attempt grants an employee_qualifications row, which is what duty eligibility reads.
    queryClient.invalidateQueries({ queryKey: ["employee_qualifications"] });
    queryClient.invalidateQueries({ queryKey: ["employee-readiness"] });
  };
}

export function useStartCertificationAttempt(employeeId: string) {
  const invalidate = useCertificationInvalidation(employeeId);
  return useMutation({
    mutationFn: async (input: { certificationVersionId: string; observedAt?: string }) => {
      // The key is omitted, not sent as null, when the caller has no observation time. A PostgreSQL
      // parameter default (`p_observed_at timestamptz default now()`) applies only when the argument
      // is left out; passing an explicit null passes null, and `certification_attempts.observed_at`
      // is NOT NULL, so sending null failed the insert with 23502 and no attempt could be started.
      const { data, error } = await supabase.rpc("start_certification_attempt" as never, {
        p_employee_id: employeeId,
        p_certification_version_id: input.certificationVersionId,
        ...(input.observedAt ? { p_observed_at: input.observedAt } : {}),
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

export function useRecordCertificationAttemptItem(employeeId: string) {
  const invalidate = useCertificationInvalidation(employeeId);
  return useMutation({
    mutationFn: async (input: {
      attemptId: string;
      checklistItemId: string;
      result: "met" | "not_met" | "not_applicable";
      evidence?: Json;
      sign?: boolean;
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_certification_attempt_item" as never, {
        p_attempt_id: input.attemptId,
        p_checklist_item_id: input.checklistItemId,
        p_result: input.result,
        p_evidence: input.evidence ?? {},
        p_sign: input.sign ?? false,
        p_notes: input.notes ?? null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

export function useSubmitCertificationAttempt(employeeId: string) {
  const invalidate = useCertificationInvalidation(employeeId);
  return useMutation({
    mutationFn: async (attemptId: string) => {
      const { data, error } = await supabase.rpc("submit_certification_attempt" as never, {
        p_attempt_id: attemptId,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: invalidate,
  });
}

/**
 * The decision. This RPC shipped in 20260711213000 and, until now, had never been called by
 * anything. It re-checks every precondition independently -- assessor qualification at observation
 * time, separation of duties, checklist effectivity, and per-item evidence and signatures -- so the
 * earlier steps' checks are early warnings rather than a substitute for it.
 */
export function useApproveCertificationAttempt(employeeId: string) {
  const invalidate = useCertificationInvalidation(employeeId);
  return useMutation({
    mutationFn: async (input: {
      attemptId: string;
      decision: "passed" | "failed";
      reason: string;
      signatureSha256: string;
    }) => {
      const { data, error } = await supabase.rpc("approve_certification_attempt" as never, {
        p_attempt_id: input.attemptId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_assessor_signature_sha256: input.signatureSha256,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}
