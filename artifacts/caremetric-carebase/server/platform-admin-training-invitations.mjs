import { createInviteUserHandler } from '../../../supabase/functions/invite-user/handler.ts';
import { parseTrainingOperation, projectTrainingResponse } from '../../../supabase/functions/_shared/trainingProtocol.ts';
import { AdminError, UUID } from './platform-admin-auth.mjs';

const rpcError = error => new AdminError(error?.code === '42501' ? 403 : error?.code === '40001' ? 409
  : ['22023','22P02'].includes(error?.code) ? 400 : 503,
error?.code === '42501' ? 'forbidden' : error?.code === '40001' ? 'conflict'
  : ['22023','22P02'].includes(error?.code) ? 'invalid_request' : 'upstream');

/** The authority is already verified by authorizePlatformAdmin, including exact
 * Hub operation, explicit native identity mapping, current role and original MFA.
 * Reuse its bounded service client; never synthesize a native user JWT.
 */
export async function executeTrainingInvitation({ authority, operation, config, getEnv = name => process.env[name] }) {
  const op = parseTrainingOperation(operation);
  if (op.operation !== 'apply' || op.action !== 'invitations.create') throw new AdminError(400,'invalid_request');
  const {native,nativeId,actor,authenticationMethod} = authority;
  const common = {p_actor:nativeId,p_hub_user:actor.user_id,p_hub_session:actor.session_id,
    p_session_started_at:actor.session_started_at,p_assurance_expires_at:actor.assurance_expires_at,p_authentication_method:authenticationMethod};
  const reserved = await native.rpc('platform_admin_training_invitation_reserve',{...common,p_operation:op});
  if (reserved.error) throw rpcError(reserved.error);
  const reservation = reserved.data;
  let receipt;
  try { receipt = projectTrainingResponse(reservation?.receipt,op); }
  catch { throw new AdminError(503,'upstream'); }
  if (reservation.execute === false && reservation.dispatchToken === null && receipt.replayed === true) return receipt;
  if (reservation.execute !== true || typeof reservation.dispatchToken !== 'string' || !UUID.test(reservation.dispatchToken)
    || receipt.replayed !== false || receipt.result.deliveryStatus !== 'unknown' || receipt.result.invitationId !== null) throw new AdminError(503,'upstream');

  let invitationId = null, completedReceipt = null;
  try {
    const revalidate = async () => {
      const check = await native.rpc('platform_admin_training_invitation_authorize',{
        ...common,p_operation:op,p_dispatch_token:reservation.dispatchToken});
      if (check.error || check.data !== true) throw rpcError(check.error);
    };
    const p=op.parameters;
    const handler=createInviteUserHandler({
      createClient:()=>native,
      getEnv:name=>name==='SUPABASE_URL'?config.supabaseUrl:name==='SUPABASE_SERVICE_ROLE_KEY'?config.serviceKey:getEnv(name),
      resolveDelegatedAuthority:async()=>({actorId:nativeId,organizationId:op.organizationId,role:p.role,
        email:p.email,firstName:p.firstName,lastName:p.lastName,employeeId:p.employeeId,facilityId:p.facilityId,revalidate,
        recordInvitationSent:async(invitedUserId,redirectTo)=>{
          const saved=await native.rpc('platform_admin_training_invitation_record',{p_actor:nativeId,p_hub_user:actor.user_id,
            p_hub_session:actor.session_id,p_request_id:op.requestId,p_dispatch_token:reservation.dispatchToken,
            p_invited_user_id:invitedUserId,p_redirect_to:redirectTo});
          if(saved.error)throw rpcError(saved.error);
          completedReceipt=projectTrainingResponse(saved.data,op);
          if(completedReceipt.result.deliveryStatus!=='sent'||typeof completedReceipt.result.invitationId!=='string')throw new AdminError(503,'upstream');
          return completedReceipt.result.invitationId;
        }}),
    });
    const response=await handler(new Request('https://cmcarebase.com/internal/training-invitation',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:p.email,
        first_name:p.firstName,last_name:p.lastName,role:p.role,organization_id:op.organizationId,
        ...(p.employeeId?{employee_id:p.employeeId}:{})}),
    }));
    if(response.ok){const result=await response.json();if(result.success===true&&typeof result.invitation_id==='string'&&UUID.test(result.invitation_id))invitationId=result.invitation_id;}
  } catch {
    // A provider timeout can occur after it sent mail. Preserve the reserved unknown
    // outcome; neither this request nor a retry is permitted to send again.
  }
  if(completedReceipt)return completedReceipt;
  const finalized=await native.rpc('platform_admin_training_invitation_finalize',{p_actor:nativeId,p_hub_user:actor.user_id,
    p_hub_session:actor.session_id,p_request_id:op.requestId,p_dispatch_token:reservation.dispatchToken,p_invitation_id:invitationId});
  // Every failure here follows a possibly accepted external send. Even a native
  // conflict can mean atomic recording committed before its response was lost;
  // never label it as a safe pre-dispatch rejection that permits a new request ID.
  if(finalized.error)throw new AdminError(503,'upstream');
  try {return projectTrainingResponse(finalized.data,op);} catch {throw new AdminError(503,'upstream');}
}
