import { useMutation } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface SignupOrganizationRequest {
  email: string;
  firstName: string;
  lastName: string;
  organizationName: string;
  legalAccepted: boolean;
  turnstileToken: string;
  redirectTo: string;
  serviceAgreementVersion: string;
  baaVersion: string;
}

export interface SignupOrganizationResponse {
  success?: boolean;
  requiresEmailVerification?: boolean;
  user?: { id: string; email: string };
  organization?: { id: string; name: string };
}

interface EdgeFunctionErrorShape {
  success?: boolean;
  error?: string;
}

async function signupErrorMessage(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    const body = (await error.context.json()) as { error?: unknown } | null;
    if (typeof body?.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Response body wasn't JSON -- keep the generic FunctionsHttpError message.
  }
  return null;
}

/**
 * Public, unauthenticated self-service signup: creates a brand-new organization and sends the
 * new org_admin an invite email via the signup-organization Edge Function. The function owns
 * Turnstile verification, rate limits, org creation, and the trusted org_admin profile update.
 */
export function useSignupOrganization() {
  return useMutation({
    mutationFn: async (payload: SignupOrganizationRequest) => {
      const { data, error } = await supabase.functions.invoke<SignupOrganizationResponse & EdgeFunctionErrorShape>(
        "signup-organization",
        {
          body: {
            email: payload.email,
            first_name: payload.firstName,
            last_name: payload.lastName,
            organization_name: payload.organizationName,
            legal_accepted: payload.legalAccepted,
            turnstile_token: payload.turnstileToken,
            redirect_to: payload.redirectTo,
            service_agreement_version: payload.serviceAgreementVersion,
            baa_version: payload.baaVersion,
          },
        },
      );
      if (error) {
        const parsed = await signupErrorMessage(error);
        throw parsed ? new Error(parsed) : error;
      }
      if (data && data.success === false) throw new Error(data.error ?? "Signup failed");
      return data as SignupOrganizationResponse;
    },
  });
}
