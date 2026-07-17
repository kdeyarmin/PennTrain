interface DemoTenantQuery {
  select: (columns: string) => DemoTenantQuery;
  eq: (column: string, value: string) => DemoTenantQuery;
  maybeSingle: () => PromiseLike<{
    data: { is_demo?: boolean } | null;
    error: { message?: string } | null;
  }>;
}

interface DemoTenantClient {
  from: (table: string) => DemoTenantQuery;
}

/**
 * Public demo members may edit synthetic operational records, but they must not
 * provision or mutate Auth identities. The caller-scoped client keeps this
 * check inside the same RLS boundary as the profile lookup.
 */
export async function isDemoOrganization(
  client: unknown,
  organizationId: string | null,
): Promise<boolean> {
  if (!organizationId) return false;
  // Accepting unknown at the Edge Function boundary avoids expanding Supabase's
  // recursive generated-schema generic in every caller while retaining a narrow
  // structural type for the only query this helper is permitted to perform.
  const demoClient = client as DemoTenantClient;
  const { data, error } = await demoClient
    .from("organizations")
    .select("is_demo")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message || "Unable to verify demo organization status");
  return data?.is_demo === true;
}
