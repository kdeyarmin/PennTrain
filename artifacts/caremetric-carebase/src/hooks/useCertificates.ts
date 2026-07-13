import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
      let query = supabase.from("certificates").select("*").order("issued_at", { ascending: false });
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.courseId) query = query.eq("course_id", filters.courseId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: options.enabled,
    refetchInterval: refetchInterval ? (query) => refetchInterval(query.state.data) : undefined,
  });
}

export interface IssueCertificatePayload {
  employeeId: string;
  courseId: string;
  assignmentId?: string;
  expiresAt?: string;
}

export function useIssueCertificate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, courseId, assignmentId, expiresAt }: IssueCertificatePayload) => {
      const { data, error } = await supabase.rpc("issue_certificate", {
        p_employee_id: employeeId,
        p_course_id: courseId,
        p_course_assignment_id: assignmentId ?? undefined,
        p_expires_at: expiresAt ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["certificates"] }),
  });
}

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

export function useGenerateCertificatePdf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (certificateId: string): Promise<GenerateCertificatePdfResult> => {
      const { data, error } = await supabase.functions.invoke<GenerateCertificatePdfResponse>(
        "generate-certificate-pdf",
        { body: { certificateId } },
      );
      if (error) throw error;
      if (!data || data.success === false || !data.url) {
        throw new Error(data?.error ?? "Failed to generate certificate PDF");
      }
      return { url: data.url, path: data.path, expiresIn: data.expiresIn };
    },
    // Generation flips pdf_status server-side; refresh lists so "Prepare PDF" becomes "Download".
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["certificates"] }),
  });
}
