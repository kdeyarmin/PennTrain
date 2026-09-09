const REQUIRED_SERVER_SETTINGS = [
  "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_BILLING_WEBHOOK_SECRET",
  "STRIPE_BILLING_PORTAL_CONFIGURATION_ID", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID", "CRON_SHARED_SECRET",
];

function runtimeMode(value) {
  if (value === undefined || value === "supabase") return "supabase";
  if (value === "railway") return value;
  throw new Error("VITE_PROVIDER_RUNTIME must be railway or supabase.");
}

/** Only these public fields are written by the build. Never serialize the environment. */
export function createProviderBuildManifest(env) {
  return {
    version: 1,
    runtime: runtimeMode(env.VITE_PROVIDER_RUNTIME),
    supabaseUrl: env.VITE_SUPABASE_URL?.replace(/\/+$/, "") ?? "",
  };
}

/** Do not promote a Railway provider build until its server credentials are configured. */
export function validateProviderRuntime(manifest, getEnv = (name) => process.env[name]) {
  if (!manifest || manifest.version !== 1 || !["railway", "supabase"].includes(manifest.runtime)) {
    throw new Error("Provider build manifest is missing or invalid. Rebuild before starting.");
  }
  const configuredMode = getEnv("VITE_PROVIDER_RUNTIME");
  if (configuredMode !== undefined && runtimeMode(configuredMode) !== manifest.runtime) {
    throw new Error("Provider runtime differs from the built frontend. Rebuild before starting.");
  }
  if (manifest.runtime === "supabase") return { enabled: false };
  const missing = REQUIRED_SERVER_SETTINGS.filter((name) => !getEnv(name)?.trim());
  const supabaseUrl = getEnv("SUPABASE_URL") ?? getEnv("VITE_SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY") ?? getEnv("VITE_SUPABASE_ANON_KEY");
  if (!supabaseUrl?.trim()) missing.push("SUPABASE_URL (or VITE_SUPABASE_URL)");
  if (!anonKey?.trim()) missing.push("SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)");
  if (missing.length) throw new Error(`Railway provider runtime is missing server settings: ${missing.join(", ")}.`);
  if (!manifest.supabaseUrl || supabaseUrl.replace(/\/+$/, "") !== manifest.supabaseUrl) {
    throw new Error("Railway provider Supabase URL differs from the built frontend. Use the same project.");
  }
  return { enabled: true };
}
