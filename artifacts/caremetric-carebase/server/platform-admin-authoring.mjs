import { AdminError, authorizePlatformAdmin, UUID } from './platform-admin-auth.mjs';
import { createHash } from 'node:crypto';

const SHA = /^[0-9a-f]{64}$/;
const EXCLUDED_SOURCE = /([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_token|refresh_token|service_role_key|authorization|accessToken|refreshToken|password|client_secret|storage_path|storage_bucket|video_url|playback_url|signed_url)"\s*:)/i;
const actions = ['learning.cloneVersion', 'learning.publishVersion'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const string = (value, min, max) => typeof value === 'string' && value === value.trim() && value.length >= min && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const uuid = value => typeof value === 'string' && UUID.test(value);
const sha = value => typeof value === 'string' && SHA.test(value);
export function parseAuthoringOperation(value) {
  if (exact(value, ['operation', 'courseId', 'versionId']) && value.operation === 'source' && uuid(value.courseId) && uuid(value.versionId)) return value;
  if (exact(value, ['operation', 'courseId']) && value.operation === 'inspect' && uuid(value.courseId)) return value;
  if (exact(value, ['operation', 'commandId', 'expectedDigest']) && value.operation === 'apply' && uuid(value.commandId) && sha(value.expectedDigest)) return value;
  if (exact(value, ['operation', 'requestId', 'action', 'courseId', 'parameters', 'reason']) && value.operation === 'preview'
    && uuid(value.requestId) && actions.includes(value.action) && uuid(value.courseId) && string(value.reason, 10, 500)
    && exact(value.parameters, value.action === 'learning.cloneVersion' ? ['versionId', 'sourceRevision', 'title'] : ['versionId', 'sourceRevision'])
    && uuid(value.parameters.versionId) && sha(value.parameters.sourceRevision)
    && (value.action !== 'learning.cloneVersion' || string(value.parameters.title, 1, 300))) return value;
  throw new AdminError(400, 'invalid_request');
}

export function projectAuthoringResult(value, op) {
  const check = truth => { if (!truth) throw new AdminError(502, 'upstream'); };
  const state = row => {
    check(object(row));
    const projected = {};
    for (const key of ['courseId', 'versionId', 'currentVersionId', 'sourceVersionId']) if (Object.hasOwn(row, key)) {
      check(uuid(row[key]) || key === 'currentVersionId' && row[key] === null); projected[key] = row[key];
    }
    if (Object.hasOwn(row, 'sourceRevision')) { check(sha(row.sourceRevision)); projected.sourceRevision = row.sourceRevision; }
    if (Object.hasOwn(row, 'aiReviewRequired')) { check(typeof row.aiReviewRequired === 'boolean'); projected.aiReviewRequired = row.aiReviewRequired; }
    check(['draft', 'published', 'archived'].includes(row.status) && string(row.title, 1, 300) && Number.isSafeInteger(row.versionNumber) && row.versionNumber > 0);
    return { ...projected, status: row.status, title: row.title, versionNumber: row.versionNumber };
  };
  check(object(value));
  if (op.operation === 'source') {
    check(value.courseId?.toLowerCase() === op.courseId.toLowerCase() && value.versionId?.toLowerCase() === op.versionId.toLowerCase()
      && typeof value.payload === 'string' && Buffer.byteLength(value.payload) <= 2000000 && sha(value.sourceRevision)
      && createHash('sha256').update(value.payload).digest('hex') === value.sourceRevision && !EXCLUDED_SOURCE.test(value.payload));
    let source; try { source = JSON.parse(value.payload); } catch { throw new AdminError(502, 'upstream'); }
    check(source?.contract === 'carebase.course.v1' && source.sourceCourseId?.toLowerCase() === op.courseId.toLowerCase()
      && source.sourceVersionId?.toLowerCase() === op.versionId.toLowerCase());
    return { courseId: value.courseId, versionId: value.versionId, sourceRevision: value.sourceRevision, payload: value.payload };
  }
  if (op.operation === 'inspect') {
    check(value.courseId?.toLowerCase() === op.courseId.toLowerCase() && string(value.title, 1, 300)
      && (uuid(value.currentVersionId) || value.currentVersionId === null) && Array.isArray(value.versions) && value.versions.length <= 20);
    return { courseId: value.courseId, title: value.title, currentVersionId: value.currentVersionId, versions: value.versions.map(row => {
      check(object(row) && uuid(row.versionId) && sha(row.sourceRevision) && typeof row.governed === 'boolean' && typeof row.aiReviewRequired === 'boolean'
        && Number.isSafeInteger(row.unresolvedPackages) && row.unresolvedPackages >= 0);
      return { ...state(row), versionId: row.versionId, sourceRevision: row.sourceRevision, governed: row.governed, unresolvedPackages: row.unresolvedPackages };
    }) };
  }
  check(uuid(value.commandId) && uuid(value.courseId) && actions.includes(value.action));
  if (op.operation === 'preview') {
    check(value.courseId.toLowerCase() === op.courseId.toLowerCase() && value.action === op.action && value.reason === op.reason
      && sha(value.previewDigest) && typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt)));
    return { commandId: value.commandId, courseId: value.courseId, action: value.action, reason: value.reason,
      previewDigest: value.previewDigest, expiresAt: value.expiresAt, before: state(value.before), after: state(value.after) };
  }
  check(value.commandId.toLowerCase() === op.commandId.toLowerCase() && uuid(value.versionId) && ['draft', 'published'].includes(value.status)
    && Number.isSafeInteger(value.versionNumber) && value.versionNumber > 0 && typeof value.replayed === 'boolean'
    && typeof value.appliedAt === 'string' && Number.isFinite(Date.parse(value.appliedAt)));
  return { commandId: value.commandId, courseId: value.courseId, action: value.action, versionId: value.versionId,
    versionNumber: value.versionNumber, status: value.status, appliedAt: value.appliedAt, replayed: value.replayed };
}

export function createLearningAuthoringHandler({ config, enabled = false, createClient, fetcher = fetch, now = () => new Date() }) {
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  return async request => {
    try {
      if (!enabled || !config.enabled || !config.commandsEnabled) throw new AdminError(503, 'unconfigured');
      let op;
      try { const raw = await request.text(); if (Buffer.byteLength(raw) > 4096) throw new Error(); op = parseAuthoringOperation(JSON.parse(raw)); }
      catch { throw new AdminError(400, 'invalid_request'); }
      const { native, nativeId, actor, authenticationMethod } = await authorizePlatformAdmin(request, {
        config, command: true, learning: true, operation: op, parseOperation: parseAuthoringOperation, createClient, fetcher, now });
      const authority = { p_actor: nativeId, p_hub_user: actor.user_id, p_hub_session: actor.session_id,
        p_session_started_at: actor.session_started_at, p_assurance_expires_at: actor.assurance_expires_at, p_authentication_method: authenticationMethod };
      const calls = {
        source: ['get_learning_authoring_source', { p_course_id: op.courseId, p_version_id: op.versionId }],
        inspect: ['inspect_learning_authoring_course', { p_course_id: op.courseId }],
        preview: ['preview_learning_authoring_command', { p_request_id: op.requestId, p_action: op.action, p_course_id: op.courseId, p_parameters: op.parameters, p_reason: op.reason }],
        apply: ['apply_learning_authoring_command', { p_command_id: op.commandId, p_expected_digest: op.expectedDigest }],
      };
      const [rpc, args] = calls[op.operation];
      const result = await native.rpc(rpc, { ...args, ...authority });
      if (result.error) {
        const code = result.error.code;
        throw new AdminError(code === '42501' ? 403 : ['40001', '23514', 'P0002'].includes(code) ? 409 : code === '22023' ? 400 : 503,
          code === '42501' ? 'forbidden' : ['40001', '23514', 'P0002'].includes(code) ? 'conflict' : code === '22023' ? 'invalid_request' : 'upstream');
      }
      const projected = projectAuthoringResult(result.data, op);
      if (Buffer.byteLength(JSON.stringify(projected)) > (op.operation === 'source' ? 4100000 : 1048576)) throw new AdminError(502, 'upstream');
      return json(projected);
    } catch (error) { return json({ error: { code: error instanceof AdminError ? error.code : 'upstream' } }, error instanceof AdminError ? error.status : 503); }
  };
}
