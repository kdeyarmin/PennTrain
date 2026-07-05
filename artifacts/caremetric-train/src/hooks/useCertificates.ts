import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type Certificate = Tables<"certificates">;

export interface ListCertificatesFilters {
  employeeId?: string;
  courseId?: string;
}

export function useListCertificates(filters: ListCertificatesFilters = {}) {
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
  });
}

export function useGetCertificate(id: string | undefined) {
  return useQuery({
    queryKey: ["certificates", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("certificates").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
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
  });
}
