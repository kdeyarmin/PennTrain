import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SignupOrganizationRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  organizationName: string;
}

export interface SignupOrganizationResponse {
  success?: boolean;
  user?: { id: string; email: string };
  organization?: { id: string; name: string };
}

interface EdgeFunctionErrorShape {
  success?: boolean;
  error?: string;
}

/**
 * Public, unauthenticated self-service signup: creates a brand-new organization and an
 * org_admin account for it via the signup-organization Edge Function. role/organization_id are
 * set through that function's service-role app_metadata call, the same trust boundary
 * create-user uses -- never client-controlled, unlike the plain public signup endpoint.
 */
export function useSignupOrganization() {
  return useMutation({
    mutationFn: async (payload: SignupOrganizationRequest) => {
      const { data, error } = await supabase.functions.invoke<SignupOrganizationResponse & EdgeFunctionErrorShape>(
        "signup-organization",
        {
          body: {
            email: payload.email,
            password: payload.password,
            first_name: payload.firstName,
            last_name: payload.lastName,
            organization_name: payload.organizationName,
          },
        },
      );
      if (error) throw error;
      if (data && data.success === false) throw new Error(data.error ?? "Signup failed");
      return data as SignupOrganizationResponse;
    },
  });
}
