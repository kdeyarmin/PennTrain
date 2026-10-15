export function regulatoryPollNotConfigured(env: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
}): { status: 503; body: { error: "regulatory_poll_not_configured"; message: string } } | null {
  if (env.supabaseUrl && env.serviceRoleKey) return null;
  return {
    status: 503,
    body: {
      error: "regulatory_poll_not_configured",
      message: "Regulatory polling is not configured.",
    },
  };
}
