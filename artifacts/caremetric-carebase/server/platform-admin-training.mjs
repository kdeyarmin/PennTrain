import { AdminError, authorizePlatformAdmin } from './platform-admin-auth.mjs';
import { parseTrainingOperation, projectTrainingResponse } from '../../../supabase/functions/_shared/trainingProtocol.ts';
import { executeTrainingInvitation } from './platform-admin-training-invitations.mjs';
export { parseTrainingOperation, projectTrainingResponse };

async function certificateResult(native, raw, operation, config, now) {
  if (!raw || raw.certificateId !== operation.certificateId) throw new AdminError(502, 'upstream');
  const result = { certificateId: raw.certificateId, status: raw.status, url: null, expiresAt: null };
  if (raw.status === 'ready') {
    // No caller-supplied locator or arbitrary redirect may cross this signing boundary.
    const path = `${operation.organizationId}/${operation.certificateId}.pdf`;
    if (raw._storageBucket !== 'certificates' || raw._storagePath !== path) throw new AdminError(502, 'upstream');
    const signed = await native.storage.from('certificates').createSignedUrl(path, 600);
    if (signed.error || typeof signed.data?.signedUrl !== 'string') throw new AdminError(503, 'upstream');
    const url = new URL(signed.data.signedUrl);
    if (url.origin !== config.supabaseUrl || url.pathname !== `/storage/v1/object/sign/certificates/${path}`
      || url.username || url.password || url.hash || !url.searchParams.get('token')) throw new AdminError(502, 'upstream');
    result.url = url.href;
    result.expiresAt = new Date(now().getTime() + 600_000).toISOString();
  }
  return result;
}

/** Trusted Hub backend only: every operation rechecks current mapped administrator authority. */
export function createPlatformTrainingHandler({ config, createClient, fetcher = fetch, now = () => new Date(), getEnv }) {
  const json = (body, status = 200) => Response.json(body, { status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  return async request => {
    try {
      if (!config.enabled || !config.commandsEnabled) throw new AdminError(503, 'unconfigured');
      if (request.method !== 'POST') throw new AdminError(405, 'method_not_allowed');
      if (request.headers.has('origin')) throw new AdminError(403, 'forbidden');
      if (request.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/json') throw new AdminError(415, 'unsupported_content_type');
      let operation;
      try { const raw = await request.text(); if (Buffer.byteLength(raw) > 8192) throw new Error(); operation = parseTrainingOperation(JSON.parse(raw)); }
      catch { throw new AdminError(400, 'invalid_request'); }
      const authority = await authorizePlatformAdmin(request, { config, command: true, operation,
        parseOperation: parseTrainingOperation, createClient, fetcher, now });
      let result;
      if (operation.operation === 'apply' && operation.action === 'invitations.create') {
        result = await executeTrainingInvitation({ authority, operation, config, createClient, fetcher, now, getEnv, request });
      } else {
        const { native, nativeId, actor, authenticationMethod } = authority;
        const response = await native.rpc('platform_admin_training', {
          p_actor: nativeId, p_hub_user: actor.user_id, p_hub_session: actor.session_id,
          p_session_started_at: actor.session_started_at, p_assurance_expires_at: actor.assurance_expires_at,
          p_authentication_method: authenticationMethod, p_operation: operation,
        });
        if (response.error) {
          const code = response.error.code;
          throw new AdminError(code === '42501' ? 403 : code === '28000' ? 401 : code === 'P0002' ? 404 : code === '54000' ? 413
            : ['40001', '23505', '23514', '55000'].includes(code) ? 409 : ['22023', '22007', '22008', '22P02'].includes(code) ? 400 : 503,
          code === '42501' ? 'forbidden' : code === '28000' ? 'unauthenticated' : code === 'P0002' ? 'notfound' : code === '54000' ? 'report_too_large'
            : ['40001', '23505', '23514', '55000'].includes(code) ? 'conflict' : ['22023', '22007', '22008', '22P02'].includes(code) ? 'invalid_request' : 'upstream');
        }
        result = operation.operation === 'certificates.read'
          ? await certificateResult(native, response.data, operation, config, now) : response.data;
      }
      let projected;
      try { projected = projectTrainingResponse(result, operation, config.supabaseUrl); }
      catch { throw new AdminError(502, 'upstream'); }
      if (Buffer.byteLength(JSON.stringify(projected)) > (operation.operation === 'enrollments.report' ? 12_000_000 : 2_000_000)) throw new AdminError(502, 'upstream');
      return json(projected);
    } catch (error) {
      return json({ error: { code: error instanceof AdminError ? error.code : 'upstream' } }, error instanceof AdminError ? error.status : 503);
    }
  };
}
