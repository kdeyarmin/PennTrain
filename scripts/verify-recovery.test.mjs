import assert from "node:assert/strict";
import test from "node:test";
import { captureRecoveryEvidence, compareRecoveryEvidence, PRODUCTION_REF, SNAPSHOT_SQL, TABLES } from "./verify-recovery.mjs";

const target = "abcdefghijklmnopqrst";
const token = "access-token-never-print";
const storageKey = "service-key-never-print";
const privateName = "resident-private-sentinel/report.pdf";
const hash = "a".repeat(64);
const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status });
const snapshot = (count = 1) => ({
  tables: Object.fromEntries(TABLES.map((table) => [table, { count: 2, sha256: hash }])),
  migrations: { count: 707, sha256: hash }, policies: { count: 40, sha256: hash },
  rls: { count: 20, sha256: hash }, storage: { count, sha256: hash }, storageRevision: { count, sha256: hash },
});
function fixture({ count = 1, content = "PDF", queryOverride, storageOverride } = {}) {
  let snapshotRequests = 0;
  return async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    if (url.startsWith("https://api.supabase.com/")) {
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      const { query, read_only } = JSON.parse(options.body);
      assert.equal(read_only, true);
      assert.match(query, /^select /);
      if (query === SNAPSHOT_SQL) {
        snapshotRequests++;
        return json([{ snapshot: queryOverride ? queryOverride(snapshotRequests) : snapshot(count) }]);
      }
      const offset = Number(query.match(/offset (\d+);$/)[1]);
      return json(Array.from({ length: Math.min(500, count - offset) }, (_, i) => ({
        bucket_id: "resident-documents", name: `${privateName}${offset + i}`, bytes: "3",
      })));
    }
    assert.match(url, /^https:\/\/[a-z]{20}\.supabase\.co\/storage\/v1\/object\/authenticated\/resident-documents\//);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.apikey, storageKey);
    return storageOverride ? storageOverride(url, options) : new Response(content);
  };
}
async function capture(fetcher = fixture(), projectRef = PRODUCTION_REF) {
  return captureRecoveryEvidence({ projectRef, token, storageKey, fetcher });
}
function assertPrivate(value) {
  for (const secret of [token, storageKey, privateName, "raw-private-data", "PDF"]) {
    assert.equal(JSON.stringify(value).includes(secret), false, "private value leaked into evidence");
  }
}

test("streams actual object bytes into hashes and projects aggregate evidence without paths or secrets", async () => {
  const result = await capture();
  assert.equal(result.status, "captured");
  assert.equal(result.objects[0].bytes, 3);
  assert.match(result.objects[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(result.objects[0]).sort(), ["bytes", "identitySha256", "sha256"]);
  assertPrivate(result);
});

test("visits every object beyond a single page", async () => {
  const result = await capture(fixture({ count: 503 }));
  assert.equal(result.status, "captured");
  assert.equal(result.objects.length, 503);
  assert.equal(new Set(result.objects.map((object) => object.identitySha256)).size, 503);
});

test("missing bytes and corrupt sizes fail closed, including missing body", async () => {
  for (const response of [() => new Response("private-content", { status: 404 }), () => new Response("PD"),
    () => new Response("PDFextra"), () => new Response(null)]) {
    const result = await capture(fixture({ storageOverride: response }));
    assert.equal(result.status, "incomplete");
    assert.equal(result.objects, undefined);
    assertPrivate(result);
  }
});

test("source writes during capture invalidate the recovery baseline", async () => {
  const result = await capture(fixture({ queryOverride: (n) => ({ ...snapshot(), migrations: { count: n, sha256: hash } }) }));
  assert.equal(result.reason, "database_changed_during_capture");
});

test("same-size replacements during capture fail while restored object timestamps may differ", async () => {
  const changed = await capture(fixture({ queryOverride: (n) => ({ ...snapshot(), storageRevision: { count: 1, sha256: n === 1 ? hash : "b".repeat(64) } }) }));
  assert.equal(changed.reason, "database_changed_during_capture");
  const source = await capture();
  const restored = await capture(fixture({ queryOverride: () => ({ ...snapshot(), storageRevision: { count: 1, sha256: "c".repeat(64) } }) }), target);
  assert.equal(compareRecoveryEvidence(source, restored).status, "matched");
});

test("sanitizes provider errors and never forwards an unrecognized response field", async () => {
  const error = await capture(async () => { throw new Error(`${token} raw-private-data`); });
  assert.equal(error.reason, "request_failed");
  const result = await capture(fixture({ queryOverride: () => ({ ...snapshot(), leaked: "raw-private-data" }) }));
  assert.equal(result.status, "captured");
  assertPrivate(error);
  assertPrivate(result);
});

test("malformed or absent credentials cause no request", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error("must not fetch"); };
  assert.equal((await captureRecoveryEvidence({ projectRef: "https://evil.example", token, storageKey, fetcher })).reason, "invalid_project_ref");
  assert.equal((await captureRecoveryEvidence({ projectRef: PRODUCTION_REF, token, fetcher })).reason, "credentials_missing");
  assert.equal(calls, 0);
});

test("rejects traversal identities before sending a Storage credential", async () => {
  let storageCalls = 0;
  const result = await capture(async (url, options) => {
    const query = JSON.parse(options.body).query;
    if (query === SNAPSHOT_SQL) return json([{ snapshot: snapshot() }]);
    if (url.startsWith("https://api.supabase.com/")) return json([{ bucket_id: "resident-documents", name: "../../auth/v1", bytes: 3 }]);
    storageCalls++;
    return new Response("PDF");
  });
  assert.equal(result.reason, "invalid_object_identity");
  assert.equal(storageCalls, 0);
});

test("matching isolated evidence is explicitly not proof a restore happened", async () => {
  const source = await capture();
  const restored = await capture(fixture(), target);
  const result = compareRecoveryEvidence(source, restored);
  assert.equal(result.status, "matched");
  assert.equal(result.databaseMatches, true);
  assert.equal(result.storageMatches, true);
  assert.equal(result.recoveryVerified, false);
  assertPrivate(result);
});

test("same-project, absent and incomplete evidence cannot pass", async () => {
  const source = await capture();
  assert.equal(compareRecoveryEvidence(source, source).status, "incomplete");
  assert.equal(compareRecoveryEvidence(source, null).status, "incomplete");
  assert.equal(compareRecoveryEvidence(source, { ...source, projectRef: target, objects: [] }).status, "incomplete");
});

test("same-sized damaged bytes and database differences fail independently", async () => {
  const source = await capture();
  const damaged = await capture(fixture({ content: "BAD" }), target);
  const result = compareRecoveryEvidence(source, damaged);
  assert.equal(result.status, "mismatch");
  assert.equal(result.mismatchedObjects, 1);
  assert.equal(result.databaseMatches, true);
  const restored = await capture(fixture(), target);
  restored.database.tables.residents.sha256 = "b".repeat(64);
  const mismatch = compareRecoveryEvidence(source, restored);
  assert.equal(mismatch.databaseMatches, false);
  assert.equal(mismatch.storageMatches, true);
});

test("detects extra and missing object identities without reporting private names", async () => {
  const source = await capture();
  const restored = await capture(fixture(), target);
  restored.objects[0].identitySha256 = "c".repeat(64);
  const result = compareRecoveryEvidence(source, restored);
  assert.equal(result.missingObjects, 1);
  assert.equal(result.extraObjects, 1);
  assert.equal(result.status, "mismatch");
  assertPrivate(result);
});
