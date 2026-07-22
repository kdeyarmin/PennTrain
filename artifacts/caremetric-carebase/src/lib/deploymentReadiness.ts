export type ReadinessStatus = "pass" | "warning" | "fail" | "manual";

export interface DeploymentReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface DeploymentReadinessEnv {
  viteSupabaseUrl?: string;
  viteSupabaseAnonKey?: string;
  viteTurnstileSiteKey?: string;
  systemJobsStale?: number;
  systemJobsFailed?: number;
}

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function deploymentReadinessChecks(env: DeploymentReadinessEnv): DeploymentReadinessCheck[] {
  const stale = env.systemJobsStale ?? 0;
  const failed = env.systemJobsFailed ?? 0;
  return [
    {
      id: "vite-supabase-url",
      label: "Vite Supabase URL",
      status: present(env.viteSupabaseUrl) ? "pass" : "fail",
      detail: present(env.viteSupabaseUrl) ? "Client Supabase URL is available to the bundle." : "Missing VITE_SUPABASE_URL; builds and client API calls will fail.",
    },
    {
      id: "vite-supabase-anon-key",
      label: "Vite Supabase anon key",
      status: present(env.viteSupabaseAnonKey) ? "pass" : "fail",
      detail: present(env.viteSupabaseAnonKey) ? "Client publishable/anon key is available to the bundle." : "Missing VITE_SUPABASE_ANON_KEY; authenticated client calls will fail.",
    },
    {
      id: "vite-turnstile-site-key",
      label: "Turnstile site key",
      status: present(env.viteTurnstileSiteKey) ? "pass" : "warning",
      detail: present(env.viteTurnstileSiteKey) ? "Signup/safety-report challenges can render." : "Missing VITE_TURNSTILE_SITE_KEY; public abuse-prevention flows need configuration.",
    },
    {
      id: "server-secrets",
      label: "Server-side secrets",
      status: "manual",
      detail: "Verify Supabase Edge Function secrets for SendGrid, Twilio, Stripe, VAPID, Turnstile secret, and CRON_SHARED_SECRET in the Supabase dashboard or deployment runbook; secret values are intentionally never exposed to the browser.",
    },
    {
      id: "system-job-health",
      label: "System job freshness",
      status: stale > 0 || failed > 0 ? "fail" : "pass",
      detail: stale > 0 || failed > 0 ? `${stale} stale and ${failed} failed/partial job(s) need operator review.` : "No stale or failed system jobs are currently reported by the control plane.",
    },
  ];
}

export function highestReadinessStatus(checks: readonly DeploymentReadinessCheck[]): ReadinessStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warning")) return "warning";
  if (checks.some((check) => check.status === "manual")) return "manual";
  return "pass";
}
