import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesUpdate } from "@/lib/database.types";

export type Profile = Tables<"profiles">;
export type ProfileUpdate = TablesUpdate<"profiles">;

export interface ListProfilesFilters {
  organizationId?: string;
  role?: string;
}

export function useListProfiles(filters: ListProfilesFilters = {}) {
  return useQuery({
    queryKey: ["profiles", filters],
    queryFn: async () => {
      let query = supabase.from("profiles").select("*").order("last_name");
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.role) query = query.eq("role", filters.role);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetProfile(id: string | undefined) {
  return useQuery({
    queryKey: ["profiles", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

/**
 * `profiles.role` / `organization_id` / `is_active` / `email` are protected by the
 * `protect_profile_privileged_fields()` DB trigger (see
 * supabase/migrations/20260704050114_fix_profiles_grants_and_email_protection.sql and
 * .../20260704050209_pin_search_path_on_trigger_functions.sql): for anyone who is not
 * platform_admin, the trigger silently reverts those four columns back to their old
 * values, so a plain client-side `.update()` on them is a silent no-op. This hook is
 * only for the remaining, non-protected fields; role/org/active/email changes must go
 * through `useAdminUpdateUser()` instead.
 */
export type ProfileSelfServiceUpdate = Pick<ProfileUpdate, "first_name" | "last_name" | "phone">;

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ProfileSelfServiceUpdate & { id: string }) => {
      const { data, error } = await supabase.from("profiles").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });
}

/**
 * Defensive shape an Edge Function response body may carry alongside (or instead of)
 * a non-2xx HTTP status. `supabase.functions.invoke` already surfaces non-2xx
 * responses via its `error` return value (typically a `FunctionsHttpError` wrapping
 * a `{ error: string }` body), so the `error`/`success` checks below are a defensive
 * second layer for a function that returns 200 with an application-level failure body.
 */
interface EdgeFunctionErrorShape {
  success?: boolean;
  message?: string;
  error?: string;
}

async function invokeEdgeFunction<TResponse>(functionName: string, body: object): Promise<TResponse> {
  const { data, error } = await supabase.functions.invoke<TResponse & EdgeFunctionErrorShape>(functionName, { body });
  if (error) throw error;
  if (data && data.success === false) {
    throw new Error(data.message ?? `${functionName} failed`);
  }
  if (data && typeof data.error === "string") {
    throw new Error(data.error);
  }
  return data as TResponse;
}

/**
 * `useCreateUserViaAdmin()` takes a camelCase payload (matching JS/TS convention for a
 * request object, as opposed to a raw DB row) and translates it to the snake_case wire
 * shape the deployed `create-user` Edge Function actually expects:
 *
 *   { email, password, first_name, last_name, role, organization_id }
 *
 * The function calls `supabase.auth.admin.createUser({ email, password, email_confirm:
 * true, user_metadata: { first_name, last_name, role, organization_id } })` with the
 * service role key after verifying the caller's own role/org permit creating that role.
 * The `handle_new_user()` trigger then inserts the matching `profiles` row. `password`
 * here is a temporary password the admin sets directly; there is no separate "send
 * invite" flow in this shape -- the created user signs in with it and should be
 * prompted to change it (a forced-reset flag is not modeled yet).
 *
 * On success: 2xx with `{ success: true, user: { id, email } }`. On failure: non-2xx
 * with `{ error: string }`.
 */
export interface CreateUserViaAdminRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string | null;
}

export interface CreateUserViaAdminResponse {
  success?: boolean;
  user?: { id: string; email: string };
}

export function useCreateUserViaAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password, firstName, lastName, role, organizationId }: CreateUserViaAdminRequest) =>
      invokeEdgeFunction<CreateUserViaAdminResponse>("create-user", {
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        role,
        organization_id: organizationId,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });
}

/**
 * `useAdminUpdateUser()` takes a camelCase payload and translates it to the snake_case
 * wire shape the deployed `admin-update-user` Edge Function actually expects:
 *
 *   { user_id, role?, organization_id?, is_active?, email? }
 *
 * Only `userId` is required; the remaining fields are the specific protected columns
 * being changed (role change, org reassignment, activate/deactivate, email change).
 * The function runs with the service role key, verifies the caller is platform_admin
 * (unrestricted) or org_admin (own org only, cannot touch/grant platform_admin, cannot
 * reassign org, cannot deactivate self) before applying anything, calls
 * `supabase.auth.admin.updateUserById()` first if `email`/`password` changed, then
 * `admin_update_profile()` (a trusted RPC, since a direct `profiles` update from a
 * service-role connection has no `auth.uid()` and would otherwise be silently reverted
 * by `protect_profile_privileged_fields()`) for the profile-column changes.
 *
 * On success: 2xx with `{ success: true, profile: {...} }`. On failure: non-2xx with
 * `{ error: string }`.
 */
export interface AdminUpdateUserRequest {
  userId: string;
  role?: string;
  organizationId?: string | null;
  isActive?: boolean;
  email?: string;
}

export interface AdminUpdateUserResponse {
  success?: boolean;
  profile?: Profile;
}

export function useAdminUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role, organizationId, isActive, email }: AdminUpdateUserRequest) =>
      invokeEdgeFunction<AdminUpdateUserResponse>("admin-update-user", {
        user_id: userId,
        ...(role !== undefined ? { role } : {}),
        ...(organizationId !== undefined ? { organization_id: organizationId } : {}),
        ...(isActive !== undefined ? { is_active: isActive } : {}),
        ...(email !== undefined ? { email } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });
}
