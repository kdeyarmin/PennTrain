import { AdminError, UUID } from './platform-admin-auth.mjs';

export const OPERATION_READS = Object.freeze(['operations.jobs.list','operations.releases.list','operations.audit.list']);
const fail=()=>{throw new AdminError(502,'upstream');};
const string=(value,max,nullable=false)=>value===null&&nullable?null:typeof value==='string'&&value.length<=max?value:fail();
const bool=(value,nullable=false)=>value===null&&nullable?null:typeof value==='boolean'?value:fail();
const id=(value,nullable=false)=>value===null&&nullable?null:typeof value==='string'&&UUID.test(value)?value.toLowerCase():fail();
const decimal=(value)=>value===null?null:typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)?value:fail();
const date=(value)=>value===null?null:typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():fail();
const member=(value,values)=>values.includes(value)?value:fail();
function keys(value,names){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length!==names.length||names.some(name=>!Object.hasOwn(value,name)))fail();}

export function projectOperationalRead(value,operation){
  keys(value,['items','total','limit','offset']);
  if(!Array.isArray(value.items)||value.items.length>operation.limit||value.limit!==operation.limit||value.offset!==operation.offset
    ||!Number.isSafeInteger(value.total)||value.total<0||value.items.length>Math.max(0,value.total-value.offset))fail();
  const items=value.items.map(row=>{
    if(operation.operation==='operations.jobs.list'){
      keys(row,['jobKey','displayName','description','schedule','executionKind','isCritical','retryMode','lastStatus','lastAttemptAt','lastSuccessAt','nextExpectedAt',
        'lastDurationMs','attemptedCount','succeededCount','failedCount','hasError','isStale','killSwitchEnabled','killSwitchCanStop']);
      return {jobKey:string(row.jobKey,200),displayName:string(row.displayName,500),description:string(row.description,10000),schedule:string(row.schedule,200,true),
        executionKind:member(row.executionKind,['sql_cron','edge_cron','worker','external']),isCritical:bool(row.isCritical),retryMode:member(row.retryMode,['automatic','manual','none']),
        lastStatus:member(row.lastStatus,['never','queued','starting','connecting','sending','running','succeeded','partial','failed','cancelled']),lastAttemptAt:date(row.lastAttemptAt),lastSuccessAt:date(row.lastSuccessAt),
        nextExpectedAt:date(row.nextExpectedAt),lastDurationMs:decimal(row.lastDurationMs),attemptedCount:decimal(row.attemptedCount),succeededCount:decimal(row.succeededCount),
        failedCount:decimal(row.failedCount),hasError:bool(row.hasError),isStale:bool(row.isStale,true),killSwitchEnabled:bool(row.killSwitchEnabled),killSwitchCanStop:bool(row.killSwitchCanStop)};
    }
    if(operation.operation==='operations.releases.list'){
      keys(row,['featureKey','displayName','description','isActive','rolloutMode','isEnabled','owner','expiresAt','updatedAt','globalKillSwitch','organizationKillSwitchCount']);
      const mode=member(row.rolloutMode,['off','cohort','global','unconfigured']);
      if(mode==='unconfigured'?(row.isEnabled!==null||row.owner!==null||row.expiresAt!==null||row.updatedAt!==null):row.isEnabled===null)fail();
      if(row.organizationKillSwitchCount===null)fail();
      return {featureKey:string(row.featureKey,100),displayName:string(row.displayName,120),description:string(row.description,10000),isActive:bool(row.isActive),
        rolloutMode:mode,isEnabled:bool(row.isEnabled,true),owner:string(row.owner,500,true),expiresAt:date(row.expiresAt),updatedAt:date(row.updatedAt),
        globalKillSwitch:bool(row.globalKillSwitch),organizationKillSwitchCount:decimal(row.organizationKillSwitchCount)};
    }
    if(operation.operation!=='operations.audit.list')fail();
    keys(row,['id','action','entityType','entityId','organizationId','actorProfileId','actorSubjectId','createdAt']);
    if(row.createdAt===null)fail();
    return {id:id(row.id),action:string(row.action,300),entityType:string(row.entityType,300),entityId:string(row.entityId,500,true),
      organizationId:id(row.organizationId,true),actorProfileId:id(row.actorProfileId,true),actorSubjectId:string(row.actorSubjectId,500,true),createdAt:date(row.createdAt)};
  });
  const identity=row=>row.jobKey??row.featureKey??row.id;
  if(new Set(items.map(identity)).size!==items.length)fail();
  return {...value,items};
}

export async function readOperations({native,nativeId,actor,authenticationMethod,operation}){
  const result=await native.rpc('platform_admin_read_operations',{
    p_actor:nativeId,p_hub_user:actor.user_id,p_hub_session:actor.session_id,
    p_session_started_at:new Date(actor.session_started_at).toISOString(),p_assurance_expires_at:new Date(actor.assurance_expires_at).toISOString(),
    p_authentication_method:authenticationMethod,p_operation:operation.operation,p_limit:operation.limit,p_offset:operation.offset,p_search:operation.search,
  });
  if(result.error)throw new AdminError(result.error.code==='42501'?403:503,result.error.code==='42501'?'forbidden':'upstream');
  return projectOperationalRead(result.data,operation);
}
