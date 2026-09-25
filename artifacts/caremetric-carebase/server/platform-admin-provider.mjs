import { AdminError, authorizePlatformAdmin } from './platform-admin-auth.mjs';
import { validProviderOperation, validProviderContext, validProviderPreview, validProviderResult, validProviderStatus, validProviderCommands } from '../../../supabase/functions/_shared/learningProviderPolicy.ts';
export function parseProviderOperation(value) {
  if (!validProviderOperation(value)) throw new AdminError(400, 'invalid_request');
  return value;
}
export function projectProviderResult(value, op) {
  const check = truth => { if (!truth) throw new AdminError(502, 'upstream'); };
  if (op.operation === 'context') check(validProviderContext(value) && value.courseId.toLowerCase() === op.courseId.toLowerCase());
  else if (op.operation === 'commands') check(validProviderCommands(value) && (value.nextOffset === null || value.nextOffset === op.offset + 20));
  else if (op.operation === 'status') check(validProviderStatus(value) && value.preview.commandId.toLowerCase() === op.commandId.toLowerCase() && value.preview.previewDigest === op.expectedDigest);
  else if (op.operation === 'preview') {
    check(validProviderPreview(value) && value.courseId.toLowerCase() === op.courseId.toLowerCase() && value.reason === op.reason
      && value.providerContextRevision === op.providerContextRevision);
    check(value.changes.every(change => Object.hasOwn(op.patch, change.field) && op.patch[change.field] === change.after));
    const signature = value.changes.find(change => change.field === 'signatureName');
    check(value.signatureTimestampAction === (signature ? signature.after === null ? 'clear' : 'record' : 'retain'));
  } else check(validProviderResult(value) && value.commandId.toLowerCase() === op.commandId.toLowerCase());
  // Exact DTO validators reject extra fields; a total output bound also covers retained legacy text.
  check(Buffer.byteLength(JSON.stringify(value)) <= 1048576);
  return value;
}
export function createLearningProviderHandler({ config, enabled = false, createClient, fetcher = fetch, now = () => new Date() }) {
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  return async request => {
    try {
      if (!enabled || !config.enabled || !config.commandsEnabled) throw new AdminError(503, 'unconfigured');
      let op;
      try { const raw = await request.text(); if (Buffer.byteLength(raw) > 32768) throw new Error(); op = parseProviderOperation(JSON.parse(raw)); }
      catch { throw new AdminError(400, 'invalid_request'); }
      const { native, nativeId, actor, authenticationMethod } = await authorizePlatformAdmin(request, {
        config, command: true, learning: true, operation: op, parseOperation: parseProviderOperation, createClient, fetcher, now });
      const authority = { p_actor: nativeId, p_hub_user: actor.user_id, p_hub_session: actor.session_id,
        p_session_started_at: actor.session_started_at, p_assurance_expires_at: actor.assurance_expires_at, p_authentication_method: authenticationMethod };
      const calls = {
        commands: ['list_learning_provider_commands', { p_course_id: op.courseId, p_offset: op.offset }],
        status: ['get_learning_provider_status', { p_command_id: op.commandId, p_expected_digest: op.expectedDigest }],
        context: ['get_learning_provider_context', { p_course_id: op.courseId }],
        preview: ['preview_learning_provider_command', { p_request_id: op.requestId, p_course_id: op.courseId, p_context_revision: op.providerContextRevision, p_patch: op.patch, p_reason: op.reason }],
        apply: ['apply_learning_provider_command', { p_command_id: op.commandId, p_expected_digest: op.expectedDigest }],
      };
      const [rpc, args] = calls[op.operation];
      const result = await native.rpc(rpc, { ...authority, ...args });
      if (result.error) {
        const code = result.error.code;
        throw new AdminError(code === '42501' ? 403 : ['40001', '23514', 'P0002'].includes(code) ? 409 : code === '22023' ? 400 : 503,
          code === '42501' ? 'forbidden' : ['40001', '23514', 'P0002'].includes(code) ? 'conflict' : code === '22023' ? 'invalid_request' : 'upstream');
      }
      return json(projectProviderResult(result.data, op));
    } catch (error) { return json({ error: { code: error instanceof AdminError ? error.code : 'upstream' } }, error instanceof AdminError ? error.status : 503); }
  };
}
