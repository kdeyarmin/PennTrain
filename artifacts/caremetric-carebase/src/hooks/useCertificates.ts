import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type Certificate = Tables<"certificates">;

export interface ListCertificatesFilters {
  employeeId?: string;
  courseId?: string;
}

// `options.enabled` matters for callers that intend to scope by employeeId but don't have one yet
// (e.g. an employee self-service page before its employees row has resolved) -- every filter field
// here is applied only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes
// to "no filter at all," silently returning every certificate RLS permits. Passing `enabled: false`
// in that case (rather than `employeeId: undefined`) is the only way to get "no results yet"
// instead of firing twice (once unscoped, once scoped) on every page load. Mirrors
// useCourseAssignments.ts's useListCourseAssignments. Defaults to `undefined`, which react-query
// treats as "always enabled," so every existing caller that doesn't pass `options` is unaffected.
export function useListCertificates(
  filters: ListCertificatesFilters = {},
  options: { enabled?: boolean; refetchInterval?: (certificates: Certificate[] | undefined) => number | false } = {},
) {
  const { refetchInterval } = options;
  return useQuery({
    queryKey: ["certificates", filters],
    queryFn: async () => {
      // PostgREST caps a single response. Page until exhausted: CourseAssignments.tsx joins this
      // whole list to its completion rows to render each Download button, so past the cap the
      // oldest completions silently lost the control with no error anywhere.
      //
      // `issued_at` alone is not a total order -- a bulk course completion issues many certificates
      // inside the same instant -- and Postgres may resolve each page's request differently inside
      // a run of equal keys, so without the `id` tie-break rows repeat on one page and vanish from
      // another. That is the same silent gap this loop exists to close.
      const pageSize = 1000;
      const rows: Certificate[] = [];
      for (let from = 0; ; from += pageSize) {
        let query = supabase
          .from("certificates")
          .select("*")
          .order("issued_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + pageSize - 1);
        if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
        if (filters.courseId) query = query.eq("course_id", filters.courseId);
        const { data, error } = await query;
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
      return rows;
    },
    enabled: options.enabled,
    refetchInterval: refetchInterval ? (query) => refetchInterval(query.state.data) : undefined,
  });
}

// A `useIssueCertificate` used to sit here, calling `issue_certificate` directly. It was removed
// rather than given a screen. `20260711154819_atomic_course_completion_certificates.sql` moved
// issuance inside `complete_course_assignment()` precisely because the two-call browser flow left a
// valid completion with no certificate whenever a request failed between them, and states that the
// older function "remains as an idempotent compatibility endpoint". Calling it from the product
// again would mint a certificate with no completion behind it -- the exact invariant that migration
// exists to hold. The function itself stays granted for callers outside this repository.

export function useVerifyCertificate(slug: string | undefined) {
  return useQuery({
    queryKey: ["verify_certificate", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_certificate", { p_slug: slug! });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!slug,
  });
}

export interface GenerateCertificatePdfResult {
  url: string;
  path: string;
  expiresIn: number;
}

interface GenerateCertificatePdfResponse extends GenerateCertificatePdfResult {
  success?: boolean;
  error?: string;
}

/**
 * A generation failure that still knows WHICH failure it was.
 *
 * supabase-js hands back a FunctionsHttpError whose message is the useless "Edge Function returned
 * a non-2xx status code" -- so the function's careful 409/422 wording never reached the person
 * reading the screen. Worse, the two are not the same situation: a job still being retried is
 * worth waiting for, and a job that has spent every attempt is invisible to every worker forever,
 * so "try again shortly" is advice that cannot come true. `exhausted` is what tells the caller it
 * needs a requeue rather than patience. Same parse pattern as useSignup's signupErrorMessage.
 */
export class CertificatePdfError extends Error {
  readonly exhausted: boolean;
  constructor(message: string, exhausted: boolean) {
    super(message);
    this.name = "CertificatePdfError";
    this.exhausted = exhausted;
  }
}

async function certificatePdfError(error: unknown): Promise<CertificatePdfError | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    const body = (await error.context.json()) as { error?: unknown; exhausted?: unknown } | null;
    if (typeof body?.error === "string" && body.error.trim()) {
      return new CertificatePdfError(body.error, body.exhausted === true);
    }
  } catch {
    // Response body wasn't JSON -- keep the generic FunctionsHttpError.
  }
  return null;
}

async function generateCertificatePdf(certificateId: string): Promise<GenerateCertificatePdfResult> {
  const { data, error } = await supabase.functions.invoke<GenerateCertificatePdfResponse>(
    "generate-certificate-pdf",
    { body: { certificateId } },
  );
  if (error) throw (await certificatePdfError(error)) ?? error;
  if (!data || data.success === false || !data.url) {
    throw new Error(data?.error ?? "Failed to generate certificate PDF");
  }
  return { url: data.url, path: data.path, expiresIn: data.expiresIn };
}

/**
 * Prepares a certificate PDF, including when the queue has already given up (BACKLOG.md I12).
 *
 * A PDF job gets five attempts, and `claim_certificate_pdf_jobs` will not claim one that has spent
 * them -- so an exhausted job is invisible to every worker, cron and manual alike, forever. Both
 * download buttons' only answer in that state was the edge function's 409 "already being prepared.
 * Please try again shortly.", which describes the one case where nothing is being prepared and
 * nothing ever will be. On the only copy of a certificate an employee may have to show an
 * inspector, a control that misdescribes a dead end is worse than one that errors.
 *
 * So: try, and if the server says the job gave up, requeue it and try once more. This is one hook
 * rather than a pattern each page repeats, because there are two download surfaces (My Certificates
 * and Course Assignments) and a recovery path that exists on only one of them is the same defect
 * again on the other.
 *
 * Requeueing is not a second retry loop. `requeue_certificate_pdf` refuses any job that is not
 * actually exhausted and decides for itself who may call it (platform admin, org_admin in the
 * certificate's organization, or the holder), and a freshly requeued job has to spend five more
 * attempts before another requeue is possible -- so tapping repeatedly cannot start more than one
 * attempt series.
 */
export function usePrepareCertificatePdf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (certificateId: string): Promise<GenerateCertificatePdfResult> => {
      try {
        return await generateCertificatePdf(certificateId);
      } catch (error) {
        if (!(error instanceof CertificatePdfError) || !error.exhausted) throw error;
        const { error: requeueError } = await supabase.rpc("requeue_certificate_pdf", {
          p_certificate_id: certificateId,
        });
        if (requeueError) throw requeueError;
        return await generateCertificatePdf(certificateId);
      }
    },
    // Generation flips pdf_status server-side; refresh lists so "Prepare PDF" becomes "Download".
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["certificates"] }),
  });
}
