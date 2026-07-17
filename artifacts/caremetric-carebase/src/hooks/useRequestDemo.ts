import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface RequestDemoPayload {
  name: string;
  email: string;
  organization?: string;
  facilityCount?: number;
  message?: string;
  sourcePath?: string;
  turnstileToken: string;
}

interface RequestDemoResponse {
  ok?: boolean;
  success?: boolean;
  error?: string;
}

/**
 * Public, unauthenticated demo request: stores the prospect's details via the
 * request-demo Edge Function, which owns Turnstile verification, validation,
 * and the service-role insert (the table has no anon write policy).
 */
export function useRequestDemo() {
  return useMutation({
    mutationFn: async (payload: RequestDemoPayload) => {
      const { data, error } = await supabase.functions.invoke<RequestDemoResponse>(
        "request-demo",
        {
          body: {
            name: payload.name,
            email: payload.email,
            organization: payload.organization || undefined,
            facility_count: payload.facilityCount,
            message: payload.message || undefined,
            source_path: payload.sourcePath,
            turnstile_token: payload.turnstileToken,
          },
        },
      );
      if (error) throw error;
      if (data && (data.ok === false || data.success === false)) {
        throw new Error(data.error ?? "Demo request failed");
      }
      return data as RequestDemoResponse;
    },
  });
}
