export function confidentialIntakeNotConfigured(env: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  turnstileSecret?: string;
}): { status: 503; body: { error: "intake_not_configured"; message: string } } | null {
  if (env.supabaseUrl && env.serviceRoleKey && env.turnstileSecret) return null;
  return {
    status: 503,
    body: {
      error: "intake_not_configured",
      message: "Confidential intake is not configured. Ask the facility to connect intake verification before submitting a report.",
    },
  };
}
