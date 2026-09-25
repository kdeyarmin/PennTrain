import { expect, test } from "@playwright/test";
import { QueryFailureRecorder } from "./helpers/queryFailures";

const response = (overrides: Partial<Parameters<QueryFailureRecorder["record"]>[0]> = {}) => ({
  sequence: 1,
  method: "POST",
  url: "http://127.0.0.1:54321/rest/v1/rpc/feature_release_active",
  body: '{"p_feature_key":"care"}',
  status: 502,
  json: async () => ({ message: "gateway unavailable" }),
  ...overrides,
});

test("a successful exact retry clears a transient query failure", async () => {
  const recorder = new QueryFailureRecorder();
  recorder.record(response());
  recorder.record(response({ sequence: 2, status: 200 }));
  expect(await recorder.unresolved()).toEqual([]);
});

test("polling retains a persistent failure until its retry succeeds or the route is cleared", async () => {
  const recorder = new QueryFailureRecorder();
  recorder.record(response());
  const first = await recorder.unresolved();
  expect(first).toHaveLength(1);
  expect(await recorder.unresolved()).toEqual(first);
  recorder.record(response({ sequence: 2, status: 200 }));
  expect(await recorder.unresolved()).toEqual([]);
  recorder.record(response({ sequence: 3, status: 403 }));
  expect(await recorder.unresolved()).toHaveLength(1);
  recorder.clear();
  expect(await recorder.unresolved()).toEqual([]);
});

test("different request bodies, URLs and methods cannot hide unresolved 400 and 403 responses", async () => {
  const recorder = new QueryFailureRecorder();
  recorder.record(response({ status: 400, json: async () => ({ code: "22023", message: "Invalid feature" }) }));
  recorder.record(response({ sequence: 2, status: 200, body: '{"p_feature_key":"training"}' }));
  recorder.record(response({ sequence: 3, status: 200, url: `${response().url}?other=true` }));
  recorder.record(response({ sequence: 4, status: 200, method: "GET" }));
  expect(await recorder.unresolved()).toEqual([
    "400 POST /rest/v1/rpc/feature_release_active [22023]: Invalid feature",
  ]);
  recorder.record(response({ sequence: 5, status: 403, json: async () => ({ code: "42501", message: "permission denied" }) }));
  expect(await recorder.unresolved()).toEqual([
    "403 POST /rest/v1/rpc/feature_release_active [42501]: permission denied",
  ]);
});

test("a late failing response or body cannot resurrect a failure after a successful retry", async () => {
  const recorder = new QueryFailureRecorder();
  let finishBody!: (value: unknown) => void;
  recorder.record(response({ json: () => new Promise(resolve => { finishBody = resolve; }) }));
  await Promise.resolve();
  recorder.record(response({ sequence: 2, status: 200 }));
  finishBody({ code: "late", message: "old failure body" });
  recorder.record(response({ sequence: 1, status: 503 }));
  expect(await recorder.unresolved()).toEqual([]);
  // A genuinely newer failure is still unresolved despite the previous success.
  recorder.record(response({ sequence: 3, status: 403 }));
  expect(await recorder.unresolved()).toEqual([
    "403 POST /rest/v1/rpc/feature_release_active: gateway unavailable",
  ]);
});

test("unresolved diagnostics await pending bodies, redact values and stay bounded", async () => {
  const recorder = new QueryFailureRecorder();
  let finishBody!: (value: unknown) => void;
  recorder.record(response({ json: () => new Promise(resolve => { finishBody = resolve; }) }));
  let completed = false;
  const unresolved = recorder.unresolved().then(result => { completed = true; return result; });
  await Promise.resolve();
  expect(completed).toBe(false);
  finishBody({
    code: "PGRST202",
    message: "error\nuser@example.com 12345678-1234-1234-1234-123456789abc Bearer confidential token=confidential https://example.com/private " + "detail ".repeat(100),
  });
  const [message] = await unresolved;
  expect(message).toContain("[PGRST202]: error [email] [id] Bearer [redacted] [redacted credential] [url]");
  expect(message).not.toMatch(/confidential|example\.com|12345678|\n/);
  expect(message.length).toBeLessThan(300);
});

test("non-JSON gateway failures remain failures without leaking response contents", async () => {
  const recorder = new QueryFailureRecorder();
  recorder.record(response({ json: async () => { throw new Error("HTML gateway response"); } }));
  expect(await recorder.unresolved()).toEqual(["502 POST /rest/v1/rpc/feature_release_active"]);
});
