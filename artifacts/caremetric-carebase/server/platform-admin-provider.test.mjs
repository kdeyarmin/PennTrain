import assert from 'node:assert/strict';
import test from 'node:test';
import { createLearningProviderHandler, parseProviderOperation, projectProviderResult } from './platform-admin-provider.mjs';
import { createLearningAuthoringHandler, parseAuthoringOperation } from './platform-admin-authoring.mjs';
import { readPlatformAdminConfig } from './platform-admin-auth.mjs';
import { validProviderPatch, realProviderDate, validProviderStatus } from '../../../supabase/functions/_shared/learningProviderPolicy.ts';
const id = n => `abc00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = { CAREMETRIC_ADMIN_ENABLED: 'true', CAREMETRIC_ADMIN_COMMANDS_ENABLED: 'true', HUB_SUPABASE_URL: 'https://hub.example.test',
  HUB_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_URL: 'https://native.example.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture',
  CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: JSON.stringify({ [id(1)]: id(2) }) };
const config = readPlatformAdminConfig(key => env[key]);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const request = (body, headers = {}) => new Request('https://cmcarebase.com/api/learning-admin/authoring', { method: 'POST',
  headers: { Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
function fixture(overrides = {}, factory = createLearningProviderHandler) {
  const calls = []; const state = { actor: { user_id: id(1), role: 'platform_admin', aal: 'aal2', session_id: id(3),
    session_started_at: '2026-09-11T14:00:00Z', assurance_expires_at: '2026-09-11T22:00:00Z' },
    user: { id: id(2) }, profile: { id: id(2), role: 'platform_admin', is_active: true },
    result: { courseId: id(4), title: 'Synthetic course', currentVersionId: id(5), versions: [] }, ...overrides };
  const fetcher = async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    if (url.origin === 'https://support-hub-web-production.up.railway.app') {
      assert.equal(url.pathname, '/api/internal/learning/carebase/authorize'); return json(state.actor);
    }
    if (url.origin === env.HUB_SUPABASE_URL) { assert.equal(url.pathname, '/rest/v1/rpc/authorize_platform_command'); return json(state.actor); }
    if (url.pathname.startsWith('/auth/')) return json({ user: state.user });
    if (url.pathname === '/rest/v1/profiles') return json([state.profile]);
    return state.rpcError ? json({ code: state.rpcError, message: 'private failure detail' }, 400) : json(state.result);
  };
  return { calls, state, handler: factory({ config, enabled: true, fetcher, now: () => new Date('2026-09-11T15:00:00Z') }) };
}

const domain = 'course.provider.v1';
const previewOp = { domain, operation: 'preview', requestId: id(8), courseId: id(4), providerContextRevision: 'a'.repeat(64), patch: { providerFullName: 'Reviewed provider' }, reason: 'Reviewed course-wide provider metadata' };
const impact = { versionCount: '9007199254740993', legacyFallbackCertificates: '9223372036854775807', governedDrafts: [] };
const preview = { commandId: id(7), courseId: id(4), action: 'learning.editProviderPolicy', reason: previewOp.reason,
  providerContextRevision: 'a'.repeat(64), previewDigest: 'b'.repeat(64), expiresAt: '2026-09-11T15:05:00Z',
  changes: [{ field: 'providerFullName', before: 'Original provider', after: 'Reviewed provider' }], signatureTimestampAction: 'retain', impact };
const result = { commandId: id(7), courseId: id(4), action: 'learning.editProviderPolicy', providerId: id(9), providerContextRevision: 'c'.repeat(64), appliedAt: '2026-09-11T15:01:00Z', replayed: false };
const applyOp = { domain, operation: 'apply', commandId: id(7), expectedDigest: 'b'.repeat(64) };
const context = { courseId: id(4), courseTitle: 'Fixture course', courseStatus: 'draft', providerContextRevision: 'a'.repeat(64), profile: null, impact };
test('provider patch is a closed sparse documentation contract with real calendar dates', () => {
  assert.equal(validProviderPatch({ reviewNotes: 'Reviewed\nnotes\tretained', lastClinicalReviewDate: '2024-02-29' }), true);
  for (const patch of [{}, { providerFullName: null }, { signatureRecordedAt: '2026-01-01' }, { credential: 'invented' }, { approved: true },
    { nextReviewDue: '2025-02-29' }, { nextReviewDue: '0000-01-01' }, { reviewNotes: 'secret https://example.test?token=hidden' },
    { providerFullName: 'Provider\u0085name' }, { reviewNotes: '  ' }, { courseAuthor: 4 }, { reviewNotes: '{"token":"hidden"}' }, { courseAuthor: '{"accessToken":"hidden"}' }]) assert.equal(validProviderPatch(patch), false);
  assert.equal(realProviderDate('2024-04-31'), false); assert.equal(realProviderDate('2024-12-31'), true);
});
test('all provider operations require the domain and reject original authoring DTOs', () => {
  for (const op of [{ domain, operation: 'context', courseId: id(4) }, previewOp, applyOp, { ...applyOp, operation: 'status' }, { domain, operation: 'commands', courseId: id(4), offset: 20 }]) {
    assert.deepEqual(parseProviderOperation(op), op);
    const { domain: omitted, ...bare } = op; assert.throws(() => parseProviderOperation(bare)); assert.throws(() => parseAuthoringOperation(op));
    assert.throws(() => parseProviderOperation({ ...op, domain: 'course.authoring.v1' }));
  }
});
test('provider projection binds exact changes and preserves counts as decimal strings', () => {
  assert.deepEqual(projectProviderResult(preview, previewOp), preview);
  for (const value of [{ ...preview, changes: [{ field: 'providerFullName', before: 'old', after: 'Unreviewed name' }] },
    { ...preview, signatureTimestampAction: 'record' }, { ...preview, providerContextRevision: 'd'.repeat(64) },
    { ...preview, impact: { ...impact, legacyFallbackCertificates: 9007199254740993 } }, { ...preview, secret: 'extra field' }]) assert.throws(() => projectProviderResult(value, previewOp));
  assert.deepEqual(projectProviderResult(result, applyOp), result);
  assert.throws(() => projectProviderResult({ ...result, commandId: id(99) }, applyOp));
});
test('status is read-only evidence and page response cannot add an apply grant', () => {
  const op = { ...applyOp, operation: 'status' };
  const value = { preview, result, canApplyThisSession: false };
  assert.deepEqual(projectProviderResult(value, op), value);
  assert.equal(validProviderStatus({ ...value, canApplyThisSession: true }), false);
  assert.equal(validProviderStatus({ ...value, result: { ...result, replayed: true } }), false);
  assert.throws(() => projectProviderResult({ ...value, preview: { ...preview, previewDigest: 'd'.repeat(64) } }, op));
  const page = { items: Array.from({ length: 20 }, (_, index) => ({ commandId: id(index + 7), expectedDigest: 'b'.repeat(64), expiresAt: preview.expiresAt, appliedAt: null })), nextOffset: 20 };
  assert.throws(() => projectProviderResult({ ...page, items: page.items.slice(0, 1) }, { domain, operation: 'commands', courseId: id(4), offset: 0 }));
  assert.deepEqual(projectProviderResult(page, { domain, operation: 'commands', courseId: id(4), offset: 0 }), page);
  assert.throws(() => projectProviderResult({ ...page, nextOffset: 40 }, { domain, operation: 'commands', courseId: id(4), offset: 0 }));
});
test('actual provider RPC requests carry mapped current actor, original session and closed projection', async () => {
  const f = fixture({ result: preview });
  const response = await f.handler(request(previewOp)); assert.equal(response.status, 200); assert.deepEqual(await response.json(), preview);
  assert.equal(f.calls.at(-1).url.pathname, '/rest/v1/rpc/preview_learning_provider_command');
  assert.equal(f.calls.at(-1).body.p_actor, id(2)); assert.equal(f.calls.at(-1).body.p_context_revision, 'a'.repeat(64));
  assert.equal(f.calls.at(-1).body.p_authentication_method, 'jwt_aal2');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('actual SMS provider ticket cannot authorize authoring apply, and authoring ticket cannot authorize provider apply', async () => {
  const actor = { user_id: id(1), role: 'platform_admin', method: 'sms', session_id: id(3), session_started_at: '2026-09-11T14:00:00Z', assurance_expires_at: '2026-09-11T22:00:00Z' };
  const bare = { operation: 'apply', commandId: id(7), expectedDigest: 'b'.repeat(64) };
  const headers = { Authorization: 'Bearer cmh_' + 'a'.repeat(43) };
  const provider = fixture({ actor: { ...actor, operation: bare }, result });
  assert.equal((await provider.handler(request(applyOp, headers))).status, 403);
  const authoring = fixture({ actor: { ...actor, operation: applyOp }, result }, createLearningAuthoringHandler);
  assert.equal((await authoring.handler(request(bare, headers))).status, 403);
  const valid = fixture({ actor: { ...actor, operation: applyOp }, result });
  assert.equal((await valid.handler(request(applyOp, headers))).status, 200);
  assert.equal(valid.calls.at(-1).body.p_authentication_method, 'app_sms');
});
test('context and receipts require current administrator usability and bounded fresh authority', async () => {
  const op = { domain, operation: 'context', courseId: id(4) };
  assert.equal((await fixture({ result: context }).handler(request(op))).status, 200);
  for (const change of [{ profile: { id: id(2), role: 'employee', is_active: true } }, { profile: { id: id(2), role: 'platform_admin', is_active: false } },
    { user: { id: id(2), banned_until: '2026-09-12T00:00:00Z' } }, { actor: { user_id: id(1), role: 'platform_admin', aal: 'aal2', session_id: id(3), session_started_at: '2026-09-10T00:00:00Z', assurance_expires_at: '2026-09-12T00:00:00Z' } }]) {
    assert.equal((await fixture({ ...change, result: context }).handler(request(op))).status, 403);
  }
  assert.equal((await fixture({ result: context }).handler(request(op, { origin: 'https://cmcarebase.com' }))).status, 403);
});
test('provider sanitizes database failures and defaults off without making network requests', async () => {
  const disabled = createLearningProviderHandler({ config, fetcher: () => { throw Error('unexpected network'); } });
  assert.equal((await disabled(request(previewOp))).status, 503);
  const response = await fixture({ rpcError: '40001' }).handler(request(previewOp));
  assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: { code: 'conflict' } });
});
