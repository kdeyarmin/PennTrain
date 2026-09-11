import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createLearningAuthoringHandler, parseAuthoringOperation, projectAuthoringResult } from './platform-admin-authoring.mjs';
import { readPlatformAdminConfig } from './platform-admin-auth.mjs';
const id = n => `abc00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = { CAREMETRIC_ADMIN_ENABLED: 'true', CAREMETRIC_ADMIN_COMMANDS_ENABLED: 'true', HUB_SUPABASE_URL: 'https://hub.example.test',
  HUB_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_URL: 'https://native.example.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture',
  CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: JSON.stringify({ [id(1)]: id(2) }) };
const config = readPlatformAdminConfig(key => env[key]);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const request = (body, headers = {}) => new Request('https://cmcarebase.com/api/learning-admin/authoring', { method: 'POST',
  headers: { Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const inspect = { operation: 'inspect', courseId: id(4) };
const preview = { operation: 'preview', requestId: id(8), action: 'learning.cloneVersion', courseId: id(4),
  parameters: { versionId: id(5), sourceRevision: 'a'.repeat(64), title: 'A new governed draft' }, reason: 'Reviewed the source and its policies' };
const apply = { operation: 'apply', commandId: id(7), expectedDigest: 'b'.repeat(64) };
function fixture(overrides = {}) {
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
  return { calls, state, handler: createLearningAuthoringHandler({ config, enabled: true, fetcher, now: () => new Date('2026-09-11T15:00:00Z') }) };
}
test('authoring defaults off without sending any authority', async () => {
  const handler = createLearningAuthoringHandler({ config, fetcher: () => { throw Error('Unexpected network'); } });
  assert.equal((await handler(request(inspect))).status, 503);
});
test('closed authoring parser rejects actor injection and incompatible action fields', () => {
  for (const value of [{ ...inspect, actor: id(9) }, { ...preview, action: 'users.setActive' },
    { ...preview, parameters: { ...preview.parameters, video_url: 'secret' } },
    { ...preview, action: 'learning.publishVersion' }, { ...preview, reason: 'short' }, { ...apply, expectedDigest: 'A'.repeat(64) }])
    assert.throws(() => parseAuthoringOperation(value));
  assert.deepEqual(parseAuthoringOperation(preview), preview);
});
test('fresh native and Hub authority is forwarded independently of untrusted operation', async () => {
  const f = fixture(); const response = await f.handler(request(inspect)); assert.equal(response.status, 200);
  assert.deepEqual(f.calls.at(-1).body, { p_course_id: id(4), p_actor: id(2), p_hub_user: id(1), p_hub_session: id(3),
    p_session_started_at: '2026-09-11T14:00:00Z', p_assurance_expires_at: '2026-09-11T22:00:00Z', p_authentication_method: 'jwt_aal2' });
});
test('cross-origin, expired session, native demotion and native ban fail before authoring RPC', async () => {
  const origin = fixture(); assert.equal((await origin.handler(request(inspect, { Origin: 'https://help.caremetric.ai' }))).status, 403); assert.equal(origin.calls.length, 0);
  for (const overrides of [{ actor: { user_id: id(1), role: 'platform_admin', aal: 'aal2', session_id: id(3), session_started_at: '2026-09-10T14:00:00Z', assurance_expires_at: '2026-09-10T22:00:00Z' } },
    { profile: { id: id(2), role: 'employee', is_active: true } }, { user: { id: id(2), banned_until: '2027-01-01T00:00:00Z' } }]) {
    const f = fixture(overrides); assert.equal((await f.handler(request(inspect))).status, 403);
    assert.ok(f.calls.every(call => !call.url.pathname.includes('inspect_learning')));
  }
});
test('SMS authoring consumes only an exact payload-bound learning capability', async () => {
  const f = fixture(); f.state.actor = { ...f.state.actor, method: 'sms', operation: inspect }; delete f.state.actor.aal;
  assert.equal((await f.handler(request(inspect, { Authorization: `Bearer cmh_${'x'.repeat(43)}` }))).status, 200);
  assert.equal(f.calls.at(-1).body.p_authentication_method, 'app_sms');
  f.state.actor.operation = { operation: 'list', limit: 1 };
  const before = f.calls.length; assert.equal((await f.handler(request(inspect, { Authorization: `Bearer cmh_${'x'.repeat(43)}` }))).status, 403);
  assert.equal(f.calls.length, before + 1);
});
test('inspect projects only bounded course definitions and IDs', async () => {
  const f = fixture(); f.state.result.private = 'private storage details';
  const response = await f.handler(request(inspect)); assert.equal(response.status, 200); assert.ok(!(await response.text()).includes('private'));
  f.state.result.versions = Array(21).fill({}); assert.equal((await f.handler(request(inspect))).status, 502);
});
test('apply projects immutable result and rejects mismatched command identity', async () => {
  const f = fixture({ result: { commandId: id(7), courseId: id(4), action: 'learning.cloneVersion', versionId: id(6), versionNumber: 2,
    status: 'draft', appliedAt: '2026-09-11T15:00:00Z', replayed: true, private: 'hidden' } });
  const response = await f.handler(request(apply)); assert.equal(response.status, 200); assert.equal((await response.json()).replayed, true);
  assert.equal(f.calls.at(-1).body.p_expected_digest, apply.expectedDigest);
  f.state.result.commandId = id(9); assert.equal((await f.handler(request(apply))).status, 502);
});
test('native readiness and stale-state errors are sanitized', async () => {
  for (const code of ['40001', '23514', 'P0002']) {
    const f = fixture({ rpcError: code }); const response = await f.handler(request(apply));
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: { code: 'conflict' } });
  }
});
const sourceOp = { operation: 'source', courseId: id(4), versionId: id(5) };
function sourceResult(extra = {}) {
  const payload = JSON.stringify({ contract: 'carebase.course.v1', sourceCourseId: id(4), sourceVersionId: id(5), ...extra });
  return { courseId: id(4), versionId: id(5), sourceRevision: createHash('sha256').update(payload).digest('hex'), payload };
}
test('source response binds exact raw bytes and rejects hidden playback credentials', () => {
  const valid = sourceResult(); assert.deepEqual(projectAuthoringResult(valid, sourceOp), valid);
  assert.throws(() => projectAuthoringResult({ ...valid, payload: valid.payload + ' ' }, sourceOp));
  assert.throws(() => projectAuthoringResult(sourceResult({ body: { playback_url: 'private' } }), sourceOp));
  assert.throws(() => projectAuthoringResult(sourceResult({ body: 'https://example.test/movie?token=private' }), sourceOp));
});
test('large escaped source fits its specific bound without increasing unrelated reads', async () => {
  const source = sourceResult({ body: '"'.repeat(650000) }); assert.ok(Buffer.byteLength(JSON.stringify(source)) > 2 * 1024 * 1024);
  const f = fixture({ result: source }); const response = await f.handler(request(sourceOp)); assert.equal(response.status, 200);
  assert.equal((await response.json()).sourceRevision, source.sourceRevision);
  const ordinary = fixture({ result: source }); assert.equal((await ordinary.handler(request(inspect))).status, 503);
  f.state.result = sourceResult({ body: 'x'.repeat(2000001) }); assert.equal((await f.handler(request(sourceOp))).status, 502);
});
