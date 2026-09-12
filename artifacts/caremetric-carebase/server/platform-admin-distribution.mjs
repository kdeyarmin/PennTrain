import {AdminError,authorizePlatformAdmin,UUID} from './platform-admin-auth.mjs';
import {projectAuthoringResult} from './platform-admin-authoring.mjs';
const domain='course.distribution.v1';
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const uuid=value=>typeof value==='string'&&UUID.test(value);
const state=value=>['draft','published','archived'].includes(value);
export function parseDistributionOperation(value){
  if(!exact(value,['domain','operation','courseId'])||value.domain!==domain||value.operation!=='context'||!uuid(value.courseId))throw new AdminError(400,'invalid_request');
  return value;
}
export function projectDistributionData(value,op){
  const check=valid=>{if(!valid)throw new AdminError(502,'upstream');};
  check(exact(value,['courseId','publicationState','currentVersionId','currentVersionState','source'])&&uuid(value.courseId)
    &&value.courseId.toLowerCase()===op.courseId.toLowerCase()&&state(value.publicationState)
    &&(value.currentVersionId===null||uuid(value.currentVersionId))&&(value.currentVersionState===null||state(value.currentVersionState))
    &&(value.currentVersionId===null)===(value.currentVersionState===null));
  const published=value.publicationState==='published'&&value.currentVersionState==='published';
  check(published?exact(value.source,['payload','sourceRevision']):value.source===null);
  if(published){
    const source=projectAuthoringResult({courseId:value.courseId,versionId:value.currentVersionId,...value.source},
      {operation:'source',courseId:op.courseId,versionId:value.currentVersionId});
    const payload=JSON.parse(source.payload);check(payload.publicationState==='published'&&payload.sourceVersionState==='published');
  }
  check(Buffer.byteLength(JSON.stringify(value))<=4096000);
  return value;
}
export function createLearningDistributionHandler({config,enabled=false,createClient,fetcher=fetch,now=()=>new Date()}){
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return async request=>{
    try{
      if(!enabled||!config.enabled||!config.commandsEnabled)throw new AdminError(503,'unconfigured');
      let op;try{const raw=await request.text();if(Buffer.byteLength(raw)>2048)throw Error();op=parseDistributionOperation(JSON.parse(raw));}catch{throw new AdminError(400,'invalid_request');}
      const {native,nativeId,actor,authenticationMethod}=await authorizePlatformAdmin(request,{config,command:true,learning:true,operation:op,parseOperation:parseDistributionOperation,createClient,fetcher,now});
      const response=await native.rpc('get_learning_distribution_context',{p_actor:nativeId,p_hub_user:actor.user_id,p_hub_session:actor.session_id,
        p_session_started_at:actor.session_started_at,p_assurance_expires_at:actor.assurance_expires_at,p_course_id:op.courseId,p_authentication_method:authenticationMethod});
      if(response.error){const code=response.error.code;throw new AdminError(code==='42501'?403:code==='P0002'?404:503,code==='42501'?'forbidden':code==='P0002'?'notfound':'upstream');}
      return json({contractVersion:1,product:'carebase',domain,operation:'context',generatedAt:now().toISOString(),data:projectDistributionData(response.data,op)});
    }catch(error){return json({error:{code:error instanceof AdminError?error.code:'upstream'}},error instanceof AdminError?error.status:503);}
  };
}
