import {AdminError,authorizePlatformAdmin} from './platform-admin-auth.mjs';
import {parseConfigurationOperation,configurationAction,sameConfigurationTarget,validConfigurationContext,
  validConfigurationPreview,validConfigurationResult,validConfigurationStatus,validConfigurationCommands} from '../../../supabase/functions/_shared/operationalConfiguration.ts';
export {parseConfigurationOperation};
const sameInstant=(a,b)=>a===null?b===null:b!==null&&Date.parse(a)===Date.parse(b);
export function projectConfigurationResult(value,operation){
  const check=ok=>{if(!ok)throw new AdminError(502,'upstream');};
  if(operation.operation==='context')check(validConfigurationContext(value)&&sameConfigurationTarget(value.target,operation.target));
  else if(operation.operation==='commands')check(validConfigurationCommands(value,operation.offset));
  else if(operation.operation==='status')check(validConfigurationStatus(value)&&value.preview.commandId.toLowerCase()===operation.commandId.toLowerCase()&&value.preview.previewDigest===operation.expectedDigest);
  else if(operation.operation==='apply')check(validConfigurationResult(value)&&value.commandId.toLowerCase()===operation.commandId.toLowerCase());
  else {
    check(validConfigurationPreview(value)&&sameConfigurationTarget(value.target,operation.target)&&value.action===configurationAction(operation.target)
      &&value.configurationRevision===operation.configurationRevision&&value.reason===operation.reason);
    const p=operation.parameters,a=value.after;
    if(operation.target.kind==='job')check(a.enabled===p.enabled&&a.reason===operation.reason);
    else if(operation.target.kind==='release')check(a.configured===true&&a.rolloutMode===p.rolloutMode&&a.isEnabled===p.isEnabled&&a.owner===p.owner&&a.changeReason===operation.reason&&sameInstant(a.expiresAt,p.expiresAt));
    else check(p.isDisabled?a.configured===true&&a.isDisabled===true&&a.reason===operation.reason&&sameInstant(a.expiresAt,p.expiresAt):a.configured===false&&a.isDisabled===false&&a.reason===null&&a.expiresAt===null);
  }
  check(Buffer.byteLength(JSON.stringify(value))<=1048576);
  return value;
}
export function createPlatformConfigurationHandler({config,createClient,fetcher=fetch,now=()=>new Date()}){
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return async request=>{
    try {
      if(!config.enabled||!config.commandsEnabled)throw new AdminError(503,'unconfigured');
      let operation;
      try {const text=await request.text();if(Buffer.byteLength(text)>4096)throw new Error();operation=parseConfigurationOperation(JSON.parse(text));}
      catch{throw new AdminError(400,'invalid_request');}
      const {native,nativeId,actor,authenticationMethod}=await authorizePlatformAdmin(request,{config,command:true,operation,parseOperation:parseConfigurationOperation,createClient,fetcher,now});
      const authority={p_actor:nativeId,p_hub_user:actor.user_id,p_hub_session:actor.session_id,p_session_started_at:actor.session_started_at,
        p_assurance_expires_at:actor.assurance_expires_at,p_authentication_method:authenticationMethod};
      const calls={
        context:['get_operational_configuration',{p_target:operation.target}],
        commands:['list_operational_configuration_commands',{p_target:operation.target,p_offset:operation.offset}],
        preview:['preview_operational_configuration_command',{p_request_id:operation.requestId,p_target:operation.target,p_configuration_revision:operation.configurationRevision,p_parameters:operation.parameters,p_reason:operation.reason}],
        apply:['apply_operational_configuration_command',{p_command_id:operation.commandId,p_expected_digest:operation.expectedDigest}],
        status:['get_operational_configuration_command_status',{p_command_id:operation.commandId,p_expected_digest:operation.expectedDigest}],
      };
      const [name,args]=calls[operation.operation],result=await native.rpc(name,{...authority,...args});
      if(result.error){const code=result.error.code;throw new AdminError(code==='42501'?403:code==='28000'?401:['40001','23514','P0002'].includes(code)?409:code==='22023'?400:503,
        code==='42501'?'forbidden':code==='28000'?'unauthenticated':['40001','23514','P0002'].includes(code)?'conflict':code==='22023'?'invalid_request':'upstream');}
      return json(projectConfigurationResult(result.data,operation));
    }catch(error){return json({error:{code:error instanceof AdminError?error.code:'upstream'}},error instanceof AdminError?error.status:503);}
  };
}
