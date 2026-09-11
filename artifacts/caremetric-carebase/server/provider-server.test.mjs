import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const SERVER_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_DIR = fileURLToPath(new URL("../../../", import.meta.url));
const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const SUPABASE_URL = "https://fixture.example.test";
const SERVER_FILES = [
  "index.mjs", "learning-package-proxy.mjs", "provider-handlers.mjs", "platform-admin-operations.mjs", "platform-admin-configuration.mjs",
  "provider-router.mjs", "provider-runtime-config.mjs", "platform-admin.mjs", "platform-admin-auth.mjs", "platform-admin-commands.mjs", "platform-admin-learning.mjs", "platform-admin-authoring.mjs", "platform-admin-data.mjs", "platform-admin-billing.mjs", "platform-admin-billing-commands.mjs", "platform-admin-checkout.mjs", "platform-admin-billing-catalog.mjs", "platform-admin-support-identity.mjs",
];
const FIXTURE_ENV = {
  VITE_PROVIDER_RUNTIME: "railway",
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: "fixture-public-key",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  STRIPE_SECRET_KEY: "sk_test_server_fixture",
  STRIPE_BILLING_WEBHOOK_SECRET: "whsec_server_fixture",
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_serverfixture",
  TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "fixture-twilio-token",
  TWILIO_VERIFY_SERVICE_SID: `VA${"b".repeat(32)}`,
  CRON_SHARED_SECRET: "fixture-cron-secret",
};

async function deadline(promise, label, milliseconds = 10_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
      timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}

async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

/** Each fixture runs the actual server sources with no inherited account credentials. */
async function launch(t, {
  legacy = false, basePath = "/", envOverrides = {}, manifestOverrides = {}, expectStartup = true,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "penntrain-provider-server-"));
  const app = join(root, "artifacts", "caremetric-carebase");
  const server = join(app, "server");
  const dist = join(app, "dist");
  const auditPath = join(root, "unexpected-fetch.txt");
  let child;
  let exited;
  t.after(async () => {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        try { await deadline(exited, "server shutdown", 3_000); }
        catch {
          child.kill("SIGKILL");
          await deadline(exited, "forced server shutdown", 3_000);
        }
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  await mkdir(server, { recursive: true });
  await mkdir(join(dist, "public"), { recursive: true });
  await Promise.all([
    ...SERVER_FILES.map((name) => copyFile(join(SERVER_DIR, name), join(server, name))),
    symlink(join(REPO_DIR, "supabase"), join(root, "supabase"), process.platform === "win32" ? "junction" : "dir"),
    symlink(join(APP_DIR, "node_modules"), join(app, "node_modules"), process.platform === "win32" ? "junction" : "dir"),
    writeFile(join(dist, "public", "index.html"), "<!doctype html><title>Server fixture</title><main>App fixture</main>"),
    // All provider transports use fetch. Blocking it in the child both prevents
    // external traffic and proves these rejected requests stop before provider use.
    writeFile(join(root, "no-provider-network.mjs"),
      `import { appendFileSync } from "node:fs";\n` +
      `globalThis.fetch = async () => { appendFileSync(${JSON.stringify(auditPath)}, "unexpected fetch\\n"); throw new Error("Provider network forbidden in server fixture"); };\n`),
  ]);
  if (!legacy) {
    await writeFile(join(dist, "provider-runtime.json"), JSON.stringify({
      version: 1, runtime: "railway", supabaseUrl: SUPABASE_URL, ...manifestOverrides,
    }));
  }
  const port = await availablePort();
  const env = {
    // Intentionally do not inherit NODE_OPTIONS, proxy settings, HOME, or secrets.
    PATH: process.env.PATH ?? "", NODE_ENV: "production", HOST: "127.0.0.1",
    PORT: String(port), BASE_PATH: basePath,
    ...(!legacy ? FIXTURE_ENV : {}), ...envOverrides,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  child = spawn(process.execPath, ["--import", pathToFileURL(join(root, "no-provider-network.mjs")).href, join(server, "index.mjs")], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let reportListening;
  const listening = new Promise((resolve) => { reportListening = resolve; });
  const collect = (chunk) => {
    output = (output + chunk.toString()).slice(-64 * 1024);
    if (output.includes("caremetric-carebase server listening on ")) reportListening();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  exited = new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (expectStartup) {
    await deadline(Promise.race([
      listening,
      exited.then((result) => { throw new Error(`Server exited before listening (${result.code}): ${output}`); }),
    ]), "server startup");
  }
  return {
    port, exited, output: () => output,
    async assertNoProviderFetch() {
      let audit = "";
      try { audit = await readFile(auditPath, "utf8"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      assert.equal(audit, "", "request reached a provider before rejecting invalid credentials");
    },
  };
}

async function request(server, path, { method = "GET", headers = {}, body } = {}) {
  return deadline(new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1", port: server.port, path, method,
      headers: { connection: "close", ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.once("error", reject);
      res.once("end", () => resolve({
        status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.once("error", reject);
    req.setTimeout(3_000, () => req.destroy(new Error("Local server request timed out")));
    req.end(body);
  }), "local server request", 5_000);
}

async function assertRejectedRoutes(server, browserPrefix = "") {
  const routes = [
    [`${browserPrefix}/api/providers/sms-mfa`, 401, { error: "Sign in to continue." }],
    [`${browserPrefix}/api/providers/create-billing-session`, 401, { error: { code: "unauthorized" } }],
    ["/api/providers/stripe-billing-webhook", 400, { error: "invalid_signature" }],
    ["/api/providers/sync-billing-quantities", 401, { error: "Unauthorized" }],
  ];
  for (const [path, status, body] of routes) {
    const response = await request(server, path, {
      method: "POST", body: "{}",
      headers: { "content-type": "application/json", "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"f".repeat(64)}` },
    });
    assert.equal(response.status, status, path);
    assert.deepEqual(JSON.parse(response.body), body, path);
    assert.match(response.headers["content-type"], /^application\/json/);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  await server.assertNoProviderFetch();
}

test("actual Railway server reports runtime health and wires all four guarded provider routes", { timeout: 20_000 }, async (t) => {
  const server = await launch(t);
  const health = await request(server, "/health");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).providerRuntime, "railway");
  await assertRejectedRoutes(server);
  const app = await request(server, "/");
  assert.equal(app.status, 200);
  assert.match(app.body, /App fixture/);
});

test("actual server supports browser BASE_PATH while keeping root cron and webhook URLs stable", { timeout: 20_000 }, async (t) => {
  const server = await launch(t, { basePath: "/app/" });
  const health = await request(server, "/health");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).providerRuntime, "railway");
  await assertRejectedRoutes(server, "/app");
  const app = await request(server, "/app/");
  assert.equal(app.status, 200);
  assert.match(app.body, /App fixture/);
  assert.equal((await request(server, "/")).status, 404);
});

for (const basePath of ["/api/", "/api/providers/"]) {
  test(`actual server preserves provider routing when BASE_PATH overlaps ${basePath}`, { timeout: 20_000 }, async (t) => {
    const server = await launch(t, { basePath });
    // With /api/providers/, the raw browser URL looks like an unknown root
    // endpoint. The valid base-prefixed route must still reach its handler.
    await assertRejectedRoutes(server, basePath.slice(0, -1));
    const app = await request(server, basePath);
    assert.equal(app.status, 200);
    assert.match(app.body, /App fixture/);
    const unknown = await request(server, `${basePath}api/providers/unknown`, { method: "POST", body: "{}" });
    assert.equal(unknown.status, 404);
    assert.deepEqual(JSON.parse(unknown.body), { error: { code: "provider_route_not_found" } });
    await server.assertNoProviderFetch();
  });
}

test("a SPA base matching a provider endpoint serves GET and HEAD while preserving provider methods", { timeout: 20_000 }, async (t) => {
  const basePath = "/api/providers/sms-mfa/";
  const server = await launch(t, { basePath });
  for (const path of [basePath.slice(0, -1), basePath]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await request(server, path, { method });
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.match(response.headers["content-type"], /^text\/html/);
      if (method === "GET") assert.match(response.body, /App fixture/);
      else assert.equal(response.body, "");
    }
  }
  const provider = await request(server, "/api/providers/sms-mfa", { method: "POST", body: "{}" });
  assert.equal(provider.status, 401);
  assert.deepEqual(JSON.parse(provider.body), { error: "Sign in to continue." });
  const preflight = await request(server, "/api/providers/sms-mfa", {
    method: "OPTIONS", headers: { origin: "https://cmcarebase.com" },
  });
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers["access-control-allow-origin"], "https://cmcarebase.com");
  await assertRejectedRoutes(server, basePath.slice(0, -1));
  await server.assertNoProviderFetch();
});

test("actual Railway startup fails before listening when a required server secret is absent", { timeout: 20_000 }, async (t) => {
  const server = await launch(t, { envOverrides: { TWILIO_AUTH_TOKEN: undefined }, expectStartup: false });
  const result = await deadline(server.exited, "startup rejection");
  assert.notEqual(result.code, 0);
  assert.match(server.output(), /Railway provider runtime is missing server settings: TWILIO_AUTH_TOKEN/);
  assert.doesNotMatch(server.output(), /server listening on/);
  assert.doesNotMatch(server.output(), /fixture-service-key|sk_test_server_fixture|whsec_server_fixture/);
  await server.assertNoProviderFetch();
});

test("actual server rejects a build manifest targeting a different Supabase project", { timeout: 20_000 }, async (t) => {
  const server = await launch(t, {
    manifestOverrides: { supabaseUrl: "https://different-project.example.test" }, expectStartup: false,
  });
  const result = await deadline(server.exited, "manifest rejection");
  assert.notEqual(result.code, 0);
  assert.match(server.output(), /Railway provider Supabase URL differs from the built frontend/);
  assert.doesNotMatch(server.output(), /server listening on/);
  await server.assertNoProviderFetch();
});

test("legacy default server starts without provider credentials and keeps provider routes unavailable", { timeout: 20_000 }, async (t) => {
  const server = await launch(t, { legacy: true });
  const health = await request(server, "/health");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).providerRuntime, "supabase");
  assert.equal((await request(server, "/")).status, 200);
  for (const name of ["sms-mfa", "create-billing-session", "stripe-billing-webhook", "sync-billing-quantities"]) {
    const response = await request(server, `/api/providers/${name}`, { method: "POST", body: "{}" });
    assert.equal(response.status, 503, name);
    assert.deepEqual(JSON.parse(response.body), { error: { code: "provider_runtime_unavailable" } });
  }
  await server.assertNoProviderFetch();
});

test("actual server keeps central administration default-off without external requests", { timeout: 20_000 }, async (t) => {
  const server = await launch(t, { legacy: true });
  const response = await request(server, "/api/platform-admin/read", { method: "POST", body: '{"operation":"overview"}' });
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(response.body), { error: { code: "unconfigured" } });
  assert.equal(response.headers["cache-control"], "no-store");
  await server.assertNoProviderFetch();
});

test("actual server wires central administration independently of provider mode and SPA base", { timeout: 20_000 }, async (t) => {
  const server = await launch(t, { legacy: true, basePath: "/app/", envOverrides: {
    CAREMETRIC_ADMIN_ENABLED: "true", HUB_SUPABASE_URL: "https://hub.example.test",
    HUB_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: "fixture-server-only-key",
    CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: JSON.stringify({
      "11111111-1111-4111-8111-111111111111": "22222222-2222-4222-8222-222222222222",
    }),
  } });
  const response = await request(server, "/api/platform-admin/read", {
    method: "POST", body: '{"operation":"overview"}', headers: { "content-type": "application/json" },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(JSON.parse(response.body), { error: { code: "unauthenticated" } });
  assert.equal((await request(server, "/app/")).status, 200);
  assert.equal(JSON.parse((await request(server, "/health")).body).providerRuntime, "supabase");
  await server.assertNoProviderFetch();
});
