import test from "node:test";
import assert from "node:assert/strict";
import { createProviderBuildManifest, validateProviderRuntime } from "./provider-runtime-config.mjs";

const url = "https://project.supabase.co";
const configured = {
  VITE_PROVIDER_RUNTIME: "railway", VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: "public-key",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service", STRIPE_SECRET_KEY: "fixture-stripe",
  STRIPE_BILLING_WEBHOOK_SECRET: "fixture-webhook", STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "fixture-portal",
  TWILIO_ACCOUNT_SID: "fixture-account", TWILIO_AUTH_TOKEN: "fixture-token",
  TWILIO_VERIFY_SERVICE_SID: "fixture-verify", CRON_SHARED_SECRET: "fixture-cron",
};

test("build manifest projects public configuration without credentials", () => {
  const manifest = createProviderBuildManifest(configured);
  assert.deepEqual(manifest, { version: 1, runtime: "railway", supabaseUrl: url });
  assert.equal(JSON.stringify(manifest).includes("fixture-"), false);
  assert.deepEqual(validateProviderRuntime(manifest, (key) => configured[key]), { enabled: true });
});

test("legacy builds stay inactive without requiring unrelated provider keys", () => {
  assert.deepEqual(validateProviderRuntime(createProviderBuildManifest({}), () => undefined), { enabled: false });
});

test("Railway startup rejects missing settings using names only", () => {
  const env = { ...configured, TWILIO_AUTH_TOKEN: "", STRIPE_SECRET_KEY: " " };
  assert.throws(() => validateProviderRuntime(createProviderBuildManifest(env), (key) => env[key]), (error) => {
    assert.match(error.message, /TWILIO_AUTH_TOKEN/);
    assert.match(error.message, /STRIPE_SECRET_KEY/);
    assert.equal(error.message.includes("fixture-"), false);
    return true;
  });
});

test("a runtime-only flag change or wrong Supabase project cannot promote a mismatched build", () => {
  const manifest = createProviderBuildManifest(configured);
  assert.throws(() => validateProviderRuntime(manifest, (key) => key === "VITE_PROVIDER_RUNTIME" ? "supabase" : configured[key]), /differs from the built frontend/);
  assert.throws(() => validateProviderRuntime(manifest, (key) => key === "SUPABASE_URL" ? "https://other.supabase.co" : configured[key]), /same project/);
  assert.throws(() => createProviderBuildManifest({ VITE_PROVIDER_RUNTIME: "anything" }), /must be railway or supabase/);
  assert.throws(() => createProviderBuildManifest({ VITE_PROVIDER_RUNTIME: "" }), /must be railway or supabase/);
  assert.throws(() => validateProviderRuntime({ version: 2, runtime: "railway" }), /manifest/);
});
