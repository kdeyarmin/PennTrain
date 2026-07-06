import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";
import type { AssessmentReason, ResidentAssessmentFormContent } from "@/lib/residentAssessmentFormSchema";

export type ResidentAssessmentForm = Omit<Tables<"resident_assessment_forms">, "content"> & {
  content: ResidentAssessmentFormContent;
};

export function useListResidentAssessmentForms(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident_assessment_forms", residentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_assessment_forms").select("*").eq("resident_id", residentId!).order("version_number", { ascending: false });
      if (error) throw error;
      return data as unknown as ResidentAssessmentForm[];
    },
    enabled: !!residentId,
  });
}

export function useGetResidentAssessmentForm(formId: string | undefined) {
  return useQuery({
    queryKey: ["resident_assessment_forms", "detail", formId],
    queryFn: async () => {
      const { data, error } = await supabase.from("resident_assessment_forms").select("*").eq("id", formId!).single();
      if (error) throw error;
      return data as unknown as ResidentAssessmentForm;
    },
    enabled: !!formId,
  });
}

// Clones the prior finalized version's content forward server-side (see
// start_resident_assessment_form() in supabase/migrations/20260706090400_resident_assessment_forms_core.sql)
// -- this is the literal mechanism behind "just revise those sections" instead of retyping
// everything on every cycle.
export function useStartResidentAssessmentForm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ residentId, reason, complianceItemId }: { residentId: string; reason: AssessmentReason; complianceItemId?: string }) => {
      const { data, error } = await supabase.rpc("start_resident_assessment_form", {
        p_resident_id: residentId,
        p_reason: reason,
        p_compliance_item_id: complianceItemId,
      });
      if (error) throw error;
      return data as unknown as ResidentAssessmentForm;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["resident_assessment_forms", data.resident_id] }),
  });
}

// Draft autosave -- a plain update, not an RPC (no cross-trigger/authorization logic beyond RLS
// applies to editing a still-open draft's content).
export function useSaveResidentAssessmentFormDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: ResidentAssessmentFormContent }) => {
      const { data, error } = await supabase.from("resident_assessment_forms").update({ content: content as unknown as Json }).eq("id", id).select().single();
      if (error) throw error;
      return data as unknown as ResidentAssessmentForm;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["resident_assessment_forms", data.resident_id] });
      queryClient.invalidateQueries({ queryKey: ["resident_assessment_forms", "detail", data.id] });
    },
  });
}

async function invokeGenerateAssessmentPdf(formId: string) {
  const { data: pdfData, error: pdfError } = await supabase.functions.invoke<{ success?: boolean; error?: string; url?: string }>(
    "generate-resident-assessment-pdf",
    { body: { formId } },
  );
  if (pdfError) throw pdfError;
  if (!pdfData || pdfData.success === false) {
    throw new Error(pdfData?.error ?? "Failed to generate the assessment PDF");
  }
  return pdfData;
}

// Locks the form, marks the prior version superseded, and completes the linked
// resident_compliance_items row (feeding Phase 2's support-plan cross-trigger) -- all server-side
// in finalize_resident_assessment_form(). Also generates and attaches the PDF, mirroring
// useComplianceBinder.ts's supabase.functions.invoke pattern.
export function useFinalizeResidentAssessmentForm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (formId: string) => {
      const { error: finalizeError } = await supabase.rpc("finalize_resident_assessment_form", { p_form_id: formId });
      if (finalizeError) throw finalizeError;
      return invokeGenerateAssessmentPdf(formId);
    },
    // onSettled, not onSuccess: if the DB finalize RPC succeeds but the PDF-generation call then
    // fails, the mutation still errors overall -- but the row is already finalized server-side, so
    // the UI must refetch it regardless of which step failed, or it keeps showing stale draft state.
    onSettled: (_data, _error, formId) => {
      queryClient.invalidateQueries({ queryKey: ["resident_assessment_forms"] });
      queryClient.invalidateQueries({ queryKey: ["resident_assessment_forms", "detail", formId] });
      queryClient.invalidateQueries({ queryKey: ["resident_compliance_items"] });
      queryClient.invalidateQueries({ queryKey: ["resident_documents"] });
    },
  });
}

// Retries PDF generation/attachment for a form that's already finalized -- covers the case where
// finalize_resident_assessment_form() succeeded but the edge-function call then failed (storage
// hiccup, transient network error): the form is finalized either way, but without this the editor's
// read-only finalized view offers no way to produce the still-missing required document.
export function useGenerateResidentAssessmentFormPdf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: invokeGenerateAssessmentPdf,
    onSettled: (_data, _error, formId) => {
      queryClient.invalidateQueries({ queryKey: ["resident_assessment_forms", "detail", formId] });
      queryClient.invalidateQueries({ queryKey: ["resident_documents"] });
    },
  });
}
