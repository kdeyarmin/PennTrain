import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface GenerateComplianceBinderPayload {
  /** Only honored for platform_admin -- every other role always gets their own organization. */
  organizationId?: string;
}

export interface GenerateComplianceBinderResult {
  url: string;
  path: string;
  expiresIn: number;
}

interface GenerateComplianceBinderResponse extends GenerateComplianceBinderResult {
  success?: boolean;
  error?: string;
}

export function useGenerateComplianceBinder() {
  return useMutation({
    mutationFn: async (payload: GenerateComplianceBinderPayload = {}): Promise<GenerateComplianceBinderResult> => {
      const { data, error } = await supabase.functions.invoke<GenerateComplianceBinderResponse>(
        "generate-compliance-binder",
        { body: { organization_id: payload.organizationId } },
      );
      if (error) throw error;
      if (!data || data.success === false || !data.url) {
        throw new Error(data?.error ?? "Failed to generate compliance binder");
      }
      return { url: data.url, path: data.path, expiresIn: data.expiresIn };
    },
  });
}
