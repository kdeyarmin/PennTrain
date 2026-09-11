import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { createProviderRouter } from "./provider-router.mjs";

async function setup(t, handler, options = {}) {
  const { onRequest, ...routerOptions } = options;
  const router = createProviderRouter({
    enabled: true,
    handlers: new Map(["sms-mfa", "create-billing-session", "stripe-billing-webhook", "sync-billing-quantities"].map((name) => [name, handler])),
    ...routerOptions,
  });
  const server = createServer(async (req, res) => {
    onRequest?.(req);
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

test('only an explicitly bounded source route permits a larger escaped response', async t => {
  const handler = () => new Response('x'.repeat(2100000));
  const ordinary = await setup(t, handler);
  assert.equal((await rawRequest(`${ordinary}/api/providers/sms-mfa`)).status, 502);
  const source = await setup(t, handler, { routes: new Map([['sms-mfa', { bytes: 2048, browser: false, responseBytes: 4100000 }]]) });
  const result = await rawRequest(`${source}/api/providers/sms-mfa`);
  assert.equal(result.status, 200); assert.equal(result.body.length, 2100000);
  const overflow = await setup(t, () => new Response('x'.repeat(4100001)), { routes: new Map([['sms-mfa', { bytes: 2048, browser: false, responseBytes: 4100000 }]]) });
  assert.equal((await rawRequest(`${overflow}/api/providers/sms-mfa`)).status, 502);
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

test("sixteen incomplete unauthenticated bodies do not occupy provider execution slots", async (t) => {
  const arrivals = Array.from({ length: 16 }, () => Promise.withResolvers());
  const calls = [];
  let settledBodies = 0;
  const url = await setup(t, (req) => {
    assert.equal(req.headers.get("authorization"), "Bearer completed-request");
    calls.push(req.url);
    return Response.json({ ok: true });
  }, {
    bodyTimeoutMs: 1_000,
    onRequest(req) {
      const id = req.headers["x-test-slow-body"];
      if (id !== undefined) req.once("data", () => arrivals[Number(id)].resolve());
    },
  });
  const slow = arrivals.map((_, id) => rawRequest(`${url}/api/providers/sms-mfa`, {
    headers: { "x-test-slow-body": String(id) }, chunks: ["{"], end: false,
  }).then((result) => { settledBodies++; return result; }));
  await Promise.all(arrivals.map(({ promise }) => promise));
  assert.equal(calls.length, 0);
  for (const name of ["sms-mfa", "stripe-billing-webhook", "sync-billing-quantities"]) {
    const result = await rawRequest(`${url}/api/providers/${name}`, {
      headers: { authorization: "Bearer completed-request" }, chunks: ["{}"],
    });
    assert.equal(result.status, 200);
  }
  assert.equal(calls.length, 3);
  assert.equal(settledBodies, 0, "provider calls must finish while all sixteen slow bodies are still pending");
  assert.deepEqual((await Promise.all(slow)).map(({ status }) => status), Array(16).fill(408));
});

test("bounded ingress sheds only incomplete bodies while execution capacity and timeout cleanup remain intact", async (t) => {
  const arrivals = Array.from({ length: 5 }, () => Promise.withResolvers());
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let calls = 0;
  const url = await setup(t, async () => {
    calls++;
    if (calls === 1) { entered.resolve(); await release.promise; }
    return Response.json({ ok: true });
  }, {
    bodyTimeoutMs: 1_000, maxConcurrent: 1, maxPendingBodies: 2,
    onRequest(req) {
      const id = req.headers["x-test-slow-body"];
      if (id !== undefined) req.once("data", () => arrivals[Number(id)].resolve());
    },
  });
  const slow = (id) => rawRequest(`${url}/api/providers/sms-mfa`, {
    headers: { "x-test-slow-body": String(id) }, chunks: ["{"], end: false,
  });
  const first = slow(0);
  const second = slow(1);
  await Promise.all(arrivals.slice(0, 2).map(({ promise }) => promise));

  // The complete newcomer gets through a saturated ingress pool, shedding its oldest body.
  const executing = rawRequest(`${url}/api/providers/sms-mfa`, { chunks: ["{}"] });
  await entered.promise;
  assert.equal((await first).status, 503);
  assert.equal(calls, 1);

  // Further ingress pressure can evict incomplete bodies, but cannot cancel the executing job.
  const third = slow(2);
  await arrivals[2].promise;
  const fourth = slow(3);
  await arrivals[3].promise;
  assert.equal((await second).status, 503);
  const busy = await rawRequest(`${url}/api/providers/sms-mfa`, { chunks: ["{}"] });
  assert.equal(busy.status, 503);
  assert.equal((await third).status, 503);
  assert.equal(calls, 1);
  release.resolve();
  assert.equal((await executing).status, 200);

  // Timeout releases the remaining incomplete body. A later incomplete/complete pair fits
  // together without evicting either request or losing the execution slot to a stale count.
  assert.equal((await fourth).status, 408);
  const fifth = slow(4);
  await arrivals[4].promise;
  assert.equal((await rawRequest(`${url}/api/providers/sms-mfa`, { chunks: ["{}"] })).status, 200);
  assert.equal(calls, 2);
  assert.equal((await fifth).status, 408);
});
