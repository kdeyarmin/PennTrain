import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { describeFunctionError } from "@/hooks/useResidentAssessmentForms";
import {
  type DocumentAnalyzerJob,
  isActiveAnalyzerStatus,
  isPdfFileName,
  makeAnalyzerUploadPath,
} from "@/lib/documentAnalyzer";

// Data layer for the State Form Document Analyzer. Uploads land in the private
// state-form-analyzer bucket, jobs are durable document_analyzer_jobs rows written
// through SECURITY DEFINER RPCs, extraction runs in the analyze-state-form edge worker
// (kicked immediately after upload, swept by cron for anything the kick missed), and the
// page follows the binder-export convention of conditional polling instead of realtime.

const ANALYZER_BUCKET = "state-form-analyzer";
export const ANALYZER_JOBS_KEY = ["document_analyzer_jobs"] as const;
const ANALYZER_SETTING_KEY = "ai_document_analyzer_enabled";

export function useListAnalyzerJobs() {
  return useQuery({
    queryKey: ANALYZER_JOBS_KEY,
    queryFn: async (): Promise<DocumentAnalyzerJob[]> => {
      const { data, error } = await supabase
        .from("document_analyzer_jobs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    // Poll while any upload is queued/processing so extraction results appear on their
    // own, matching useComplianceBinder's job polling.
    refetchInterval: (query) =>
      query.state.data?.some((job) => isActiveAnalyzerStatus(job.status)) ? 4_000 : false,
  });
}

/**
 * The extraction kill switch (PHI/BAA gate). Platform admins can read
 * platform_settings directly; the edge worker enforces the same setting server-side.
 */
export function useAnalyzerEnabled() {
  return useQuery({
    queryKey: ["platform_settings", ANALYZER_SETTING_KEY],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", ANALYZER_SETTING_KEY)
        .maybeSingle();
      if (error) throw error;
      return data?.value === true;
    },
    staleTime: 30_000,
  });
}

// Fire-and-forget extraction kicks. Processing state lives on the job row, so failures
// here are deliberately swallowed: the row keeps polling as queued and the cron sweep
// picks it up. Two at a time keeps a big batch from opening dozens of long requests.
async function kickAnalyzerJobs(queryClient: QueryClient, jobIds: string[]) {
  const queue = [...jobIds];
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    for (let jobId = queue.shift(); jobId !== undefined; jobId = queue.shift()) {
      try {
        await supabase.functions.invoke("analyze-state-form", { body: { job_id: jobId } });
      } catch {
        // The cron sweep retries anything a kick failed to process.
      }
      await queryClient.invalidateQueries({ queryKey: ANALYZER_JOBS_KEY });
    }
  });
  await Promise.all(workers);
}

export interface AnalyzerUploadRejection {
  fileName: string;
  reason: string;
}

export interface AnalyzerUploadResult {
  enqueued: DocumentAnalyzerJob[];
  rejected: AnalyzerUploadRejection[];
}

export function useUploadAnalyzerDocuments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]): Promise<AnalyzerUploadResult> => {
      const enqueued: DocumentAnalyzerJob[] = [];
      const rejected: AnalyzerUploadRejection[] = [];

      for (const file of files) {
        if (!isPdfFileName(file.name)) {
          rejected.push({ fileName: file.name, reason: "Only PDF state forms can be analyzed" });
          continue;
        }
        const path = makeAnalyzerUploadPath(file.name);
        const { error: uploadError } = await supabase.storage
          .from(ANALYZER_BUCKET)
          .upload(path, file, { contentType: "application/pdf" });
        if (uploadError) {
          rejected.push({ fileName: file.name, reason: uploadError.message });
          continue;
        }
        const { data: jobRow, error: enqueueError } = await supabase.rpc("enqueue_document_analyzer_job", {
          p_file_name: file.name,
          p_file_size: file.size,
          p_source_path: path,
        });
        if (enqueueError || !jobRow) {
          // Roll the orphaned object back so a re-upload of the same file starts clean.
          await supabase.storage.from(ANALYZER_BUCKET).remove([path]);
          rejected.push({ fileName: file.name, reason: enqueueError?.message ?? "Failed to queue the upload" });
          continue;
        }
        enqueued.push(jobRow as unknown as DocumentAnalyzerJob);
      }

      return { enqueued, rejected };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ANALYZER_JOBS_KEY });
      if (result.enqueued.length > 0) {
        void kickAnalyzerJobs(queryClient, result.enqueued.map((job) => job.id));
      }
    },
  });
}

export interface AnalyzerDraftPayload {
  jobId: string;
  residentName: string;
  facilityName: string;
  stateFormTemplate: string;
  reviewDueDate: string;
  /** YYYY-MM-DD or empty string to clear. */
  admissionDate: string;
  notes: string;
  /** Facility for resident-chart creation; empty string to clear. */
  facilityId: string;
}

export function useUpdateAnalyzerDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AnalyzerDraftPayload): Promise<DocumentAnalyzerJob> => {
      const { data, error } = await supabase.rpc("update_document_analyzer_job_draft", {
        p_job_id: payload.jobId,
        p_resident_name: payload.residentName,
        p_facility_name: payload.facilityName,
        p_state_form_template: payload.stateFormTemplate,
        p_review_due_date: payload.reviewDueDate,
        p_admission_date: payload.admissionDate || undefined,
        p_notes: payload.notes,
        p_facility_id: payload.facilityId || undefined,
      });
      if (error) throw error;
      return data as unknown as DocumentAnalyzerJob;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ANALYZER_JOBS_KEY }),
  });
}

export function useApproveAnalyzerJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string): Promise<DocumentAnalyzerJob> => {
      const { data, error } = await supabase.rpc("approve_document_analyzer_job", { p_job_id: jobId });
      if (error) throw error;
      return data as unknown as DocumentAnalyzerJob;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ANALYZER_JOBS_KEY }),
  });
}

export function useRetryAnalyzerJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string): Promise<DocumentAnalyzerJob> => {
      const { data, error } = await supabase.rpc("retry_document_analyzer_job", { p_job_id: jobId });
      if (error) throw error;
      return data as unknown as DocumentAnalyzerJob;
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ANALYZER_JOBS_KEY });
      void kickAnalyzerJobs(queryClient, [job.id]);
    },
  });
}

export function useMarkAnalyzerChartCreated() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { jobId: string; residentId: string }): Promise<DocumentAnalyzerJob> => {
      const { data, error } = await supabase.rpc("mark_document_analyzer_job_chart_created", {
        p_job_id: payload.jobId,
        p_resident_id: payload.residentId,
      });
      if (error) throw error;
      return data as unknown as DocumentAnalyzerJob;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ANALYZER_JOBS_KEY }),
  });
}

export function useDeclineAnalyzerChart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string): Promise<DocumentAnalyzerJob> => {
      const { data, error } = await supabase.rpc("decline_document_analyzer_job_chart", { p_job_id: jobId });
      if (error) throw error;
      return data as unknown as DocumentAnalyzerJob;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ANALYZER_JOBS_KEY }),
  });
}

export interface AnalyzerPacketResult {
  success?: boolean;
  url?: string;
  path?: string;
  expiresIn?: number;
  jobCount?: number;
  error?: string;
}

export function useExportAnalyzerPacket() {
  return useMutation({
    mutationFn: async (jobIds?: string[]): Promise<AnalyzerPacketResult> => {
      const { data, error } = await supabase.functions.invoke<AnalyzerPacketResult>(
        "generate-analyzer-packet",
        { body: jobIds && jobIds.length > 0 ? { job_ids: jobIds } : {} },
      );
      if (error) throw new Error(await describeFunctionError(error, "Failed to generate the export packet"));
      if (!data || data.success === false || !data.url) {
        throw new Error(data?.error ?? "Failed to generate the export packet");
      }
      return data;
    },
  });
}
