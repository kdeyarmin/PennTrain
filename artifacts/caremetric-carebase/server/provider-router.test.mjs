import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { createProviderRouter } from "./provider-router.mjs";

async function setup(t, handler, options = {}) {
  const router = createProviderRouter({
    enabled: true,
    handlers: new Map(["sms-mfa", "create-billing-session", "stripe-billing-webhook", "sync-billing-quantities"].map((name) => [name, handler])),
    ...options,
  });
  const server = createServer(async (req, res) => {
    if (!await router(req, res, new URL(req.url, "http://localhost").pathname)) {
      res.writeHead(418); res.end("outside provider router");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

function rawRequest(url, { headers = {}, chunks = [], end = true, method = "POST" } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    for (const chunk of chunks) req.write(chunk);
    if (end) req.end();
    else req.flushHeaders();
  });
}

test("webhook reaches handler with identical UTF-8 bytes and only allowed request headers", async (t) => {
  const payload = Buffer.from('{ "id": "evt_test", "label": "café 🟢", "v": 1 }\n');
  let calls = 0;
  const url = await setup(t, async (req) => {
    calls++;
    assert.equal(req.url, "https://cmcarebase.com/api/providers/stripe-billing-webhook");
    assert.deepEqual(Buffer.from(await req.arrayBuffer()), payload);
    assert.equal(req.headers.get("stripe-signature"), "fixture-signature");
    assert.equal(req.headers.get("cookie"), null);
    assert.equal(req.headers.get("x-forwarded-host"), null);
    return Response.json({ received: true }, { headers: { "set-cookie": "no=1", "cache-control": "public", "x-correlation-id": "evt_test" } });
  });
  const result = await rawRequest(`${url}/api/providers/stripe-billing-webhook`, {
    chunks: [payload.subarray(0, 36), payload.subarray(36)],
    headers: { "stripe-signature": "fixture-signature", cookie: "private=1", "x-forwarded-host": "attacker.invalid" },
  });
  assert.equal(result.status, 200); assert.equal(calls, 1);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(result.headers["x-correlation-id"], "evt_test");
});

test("unknown routes, unsupported methods and inactive runtime never call a handler", async (t) => {
  let calls = 0;
  const handler = () => { calls++; return Response.json({}); };
  const url = await setup(t, handler);
  assert.equal((await rawRequest(`${url}/api/providers/sms-mfa/extra`)).status, 404);
  assert.equal((await rawRequest(`${url}/api/providers/sms-mfa`, { method: "GET" })).status, 405);
  assert.equal((await rawRequest(`${url}/api/providers/stripe-billing-webhook`, { method: "OPTIONS" })).status, 405);
  assert.equal((await rawRequest(`${url}/unrelated`, { method: "GET" })).status, 418);
  const disabled = await setup(t, handler, { enabled: false });
  assert.equal((await rawRequest(`${disabled}/api/providers/sms-mfa`)).status, 503);
  assert.equal(calls, 0);
});

test("chunked and declared oversized bodies and encoded payloads are rejected before dispatch", async (t) => {
  let calls = 0;
  const url = await setup(t, () => { calls++; return Response.json({}); });
  assert.equal((await rawRequest(`${url}/api/providers/sms-mfa`, { chunks: [Buffer.alloc(2049)] })).status, 413);
  assert.equal((await rawRequest(`${url}/api/providers/sms-mfa`, { headers: { "content-length": "9000" } })).status, 413);
  assert.equal((await rawRequest(`${url}/api/providers/sms-mfa`, { headers: { "content-encoding": "gzip" }, chunks: ["compressed"] })).status, 415);
  assert.equal(calls, 0);
});

test("an unfinished body expires without invoking the handler", async (t) => {
  let calls = 0;
  const url = await setup(t, () => { calls++; return Response.json({}); }, { bodyTimeoutMs: 30 });
  const result = await rawRequest(`${url}/api/providers/sms-mfa`, { chunks: ["{"], end: false });
  assert.equal(result.status, 408); assert.equal(calls, 0);
});

test("handler deadline cancels request work without retry or raw diagnostics", async (t) => {
  let calls = 0;
  let aborted = false;
  const url = await setup(t, async (req) => {
    calls++;
    await new Promise((resolve) => req.signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
    throw new Error("fixture-secret-provider-error");
  }, { handlerTimeoutMs: 30 });
  const result = await rawRequest(`${url}/api/providers/create-billing-session`, { chunks: ["{}"] });
  assert.equal(result.status, 504); assert.equal(calls, 1); assert.equal(aborted, true);
  assert.equal(result.body.includes("fixture-secret"), false);
});

test("unexpected handler errors and oversized responses remain bounded and sanitized", async (t) => {
  const bad = await setup(t, () => { throw new Error("fixture-secret-provider-error"); });
  const result = await rawRequest(`${bad}/api/providers/sms-mfa`);
  assert.equal(result.status, 502); assert.equal(result.body.includes("fixture-secret"), false);
  const large = await setup(t, () => new Response("x".repeat(1024 * 1024 + 1)));
  assert.equal((await rawRequest(`${large}/api/providers/sms-mfa`)).status, 502);
});

test("concurrency is bounded while an accepted handler owns a request", async (t) => {
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const url = await setup(t, async () => {
    entered(); await new Promise((resolve) => { release = resolve; }); return Response.json({ ok: true });
  }, { maxConcurrent: 1 });
  const first = rawRequest(`${url}/api/providers/sms-mfa`);
  await started;
  assert.equal((await rawRequest(`${url}/api/providers/sms-mfa`)).status, 503);
  release(); assert.equal((await first).status, 200);
});
