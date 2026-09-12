/** Closed operational settings contract; does not dispatch jobs or grant entitlements. */
export const CONFIGURATION_DOMAIN = 'operations.config.v1' as const;
export type ConfigurationTarget = {kind:'job';jobKey:string}|{kind:'release';featureKey:string}|{kind:'featureKill';featureKey:string;organizationId:string|null};
export type ConfigurationParameters = {enabled:boolean}|{rolloutMode:'off'|'global';isEnabled:boolean;owner:string;expiresAt:string|null}|{isDisabled:boolean;expiresAt:string|null};
export type ConfigurationOperation =
  | {domain:typeof CONFIGURATION_DOMAIN;operation:'context';target:ConfigurationTarget}
  | {domain:typeof CONFIGURATION_DOMAIN;operation:'preview';requestId:string;target:ConfigurationTarget;configurationRevision:string;parameters:ConfigurationParameters;reason:string}
  | {domain:typeof CONFIGURATION_DOMAIN;operation:'apply'|'status';commandId:string;expectedDigest:string}
  | {domain:typeof CONFIGURATION_DOMAIN;operation:'commands';target:ConfigurationTarget;offset:number};
export type ConfigurationState = {enabled:boolean;reason:string|null}
  | {configured:boolean;rolloutMode:'off'|'cohort'|'global'|null;isEnabled:boolean|null;owner:string|null;expiresAt:string|null;changeReason:string|null}
  | {configured:boolean;isDisabled:boolean;reason:string|null;expiresAt:string|null};
export type ConfigurationImpact = {kind:'job';isActive:boolean;executionKind:'sql_cron'|'edge_cron'|'worker'|'external';killSwitchCanStop:boolean}
  | {kind:'feature';definitionActive:boolean;organizationName:string|null;globalKillSwitchActive:boolean;organizationKillSwitchCount:string;retainedCohortCount:string;retainedMembershipCount:string;nextBoundaryAt:string|null};
export type ConfigurationContext = {target:ConfigurationTarget;displayName:string;configurationRevision:string;state:ConfigurationState;impact:ConfigurationImpact};
export type ConfigurationAction = 'operations.setJobKillSwitch'|'operations.setReleaseFlag'|'operations.setFeatureKillSwitch';
export type ConfigurationPreview = {commandId:string;target:ConfigurationTarget;action:ConfigurationAction;reason:string;configurationRevision:string;previewDigest:string;expiresAt:string;before:ConfigurationState;after:ConfigurationState;impact:ConfigurationImpact};
export type ConfigurationResult = {commandId:string;target:ConfigurationTarget;action:ConfigurationAction;configurationRevision:string;appliedAt:string;replayed:boolean;state:ConfigurationState};
export type ConfigurationStatus = {preview:ConfigurationPreview;result:ConfigurationResult|null;canApplyThisSession:boolean};
export type ConfigurationCommands = {items:Array<{commandId:string;expectedDigest:string;expiresAt:string;appliedAt:string|null}>;nextOffset:number|null};

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:unknown,k:string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const id=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const line=(v:unknown,max:number,min=1):v is string=>typeof v==='string'&&v.length>=min&&v.length<=max&&v===v.trim()&&!/\p{Cc}/u.test(v);
const legacy=(v:unknown):v is string=>typeof v==='string'&&v.length<=200000&&!v.includes('\0');
const nullableText=(v:unknown)=>v===null||legacy(v);
const instant=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
const nullableInstant=(v:unknown)=>v===null||instant(v);
const count=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const offset=(v:unknown):v is number=>Number.isInteger(v)&&Number(v)>=0&&Number(v)<=10000;
export function validConfigurationTarget(v:unknown):v is ConfigurationTarget {
  if(!object(v))return false;
  if(v.kind==='job')return keys(v,['kind','jobKey'])&&line(v.jobKey,200);
  if(v.kind==='release')return keys(v,['kind','featureKey'])&&line(v.featureKey,100);
  return v.kind==='featureKill'&&keys(v,['kind','featureKey','organizationId'])&&line(v.featureKey,100)&&(v.organizationId===null||id(v.organizationId));
}
export function configurationAction(target:ConfigurationTarget):ConfigurationAction {
  return target.kind==='job'?'operations.setJobKillSwitch':target.kind==='release'?'operations.setReleaseFlag':'operations.setFeatureKillSwitch';
}
export function sameConfigurationTarget(a:ConfigurationTarget,b:ConfigurationTarget):boolean {
  return a.kind===b.kind&&(a.kind==='job'&&b.kind==='job'?a.jobKey===b.jobKey:
    a.kind==='release'&&b.kind==='release'?a.featureKey===b.featureKey:
    a.kind==='featureKill'&&b.kind==='featureKill'&&a.featureKey===b.featureKey&&a.organizationId?.toLowerCase()===b.organizationId?.toLowerCase());
}
export function validConfigurationParameters(target:ConfigurationTarget,v:unknown):v is ConfigurationParameters {
  if(target.kind==='job')return keys(v,['enabled'])&&typeof v.enabled==='boolean';
  if(target.kind==='release')return keys(v,['rolloutMode','isEnabled','owner','expiresAt'])&&line(v.owner,200)&&nullableInstant(v.expiresAt)
    &&((v.rolloutMode==='global'&&v.isEnabled===true)||(v.rolloutMode==='off'&&v.isEnabled===false));
  return keys(v,['isDisabled','expiresAt'])&&typeof v.isDisabled==='boolean'&&nullableInstant(v.expiresAt);
}
export function parseConfigurationOperation(v:unknown):ConfigurationOperation {
  if(!object(v)||v.domain!==CONFIGURATION_DOMAIN)throw new Error('Invalid operational configuration request.');
  let valid=false;
  if(v.operation==='context')valid=keys(v,['domain','operation','target'])&&validConfigurationTarget(v.target);
  if(v.operation==='commands')valid=keys(v,['domain','operation','target','offset'])&&validConfigurationTarget(v.target)&&offset(v.offset);
  if(v.operation==='apply'||v.operation==='status')valid=keys(v,['domain','operation','commandId','expectedDigest'])&&id(v.commandId)&&sha(v.expectedDigest);
  if(v.operation==='preview')valid=keys(v,['domain','operation','requestId','target','configurationRevision','parameters','reason'])&&id(v.requestId)&&validConfigurationTarget(v.target)
    &&sha(v.configurationRevision)&&validConfigurationParameters(v.target,v.parameters)&&line(v.reason,500,10);
  if(!valid||new TextEncoder().encode(JSON.stringify(v)).byteLength>4096)throw new Error('Invalid operational configuration request.');
  return v as ConfigurationOperation;
}
export function validConfigurationState(target:ConfigurationTarget,v:unknown):v is ConfigurationState {
  if(target.kind==='job')return keys(v,['enabled','reason'])&&typeof v.enabled==='boolean'&&nullableText(v.reason);
  if(target.kind==='release')return keys(v,['configured','rolloutMode','isEnabled','owner','expiresAt','changeReason'])&&typeof v.configured==='boolean'
    &&(v.configured?['off','cohort','global'].includes(String(v.rolloutMode))&&typeof v.isEnabled==='boolean'&&legacy(v.owner)&&legacy(v.changeReason):v.rolloutMode===null&&v.isEnabled===null&&v.owner===null&&v.changeReason===null&&v.expiresAt===null)
    &&nullableInstant(v.expiresAt);
  return keys(v,['configured','isDisabled','reason','expiresAt'])&&typeof v.configured==='boolean'&&typeof v.isDisabled==='boolean'&&nullableText(v.reason)&&nullableInstant(v.expiresAt)
    &&v.configured===v.isDisabled&&(v.configured||(v.reason===null&&v.expiresAt===null));
}
export function validConfigurationImpact(target:ConfigurationTarget,v:unknown):v is ConfigurationImpact {
  if(target.kind==='job')return keys(v,['kind','isActive','executionKind','killSwitchCanStop'])&&v.kind==='job'&&typeof v.isActive==='boolean'
    &&['sql_cron','edge_cron','worker','external'].includes(String(v.executionKind))&&typeof v.killSwitchCanStop==='boolean';
  return keys(v,['kind','definitionActive','organizationName','globalKillSwitchActive','organizationKillSwitchCount','retainedCohortCount','retainedMembershipCount','nextBoundaryAt'])&&v.kind==='feature'
    &&typeof v.definitionActive==='boolean'&&nullableText(v.organizationName)&&typeof v.globalKillSwitchActive==='boolean'&&count(v.organizationKillSwitchCount)
    &&count(v.retainedCohortCount)&&count(v.retainedMembershipCount)&&nullableInstant(v.nextBoundaryAt)
    &&(target.kind==='featureKill'&&target.organizationId!==null?legacy(v.organizationName):v.organizationName===null);
}
export function validConfigurationContext(v:unknown):v is ConfigurationContext {
  return keys(v,['target','displayName','configurationRevision','state','impact'])&&validConfigurationTarget(v.target)&&legacy(v.displayName)&&sha(v.configurationRevision)
    &&validConfigurationState(v.target,v.state)&&validConfigurationImpact(v.target,v.impact);
}
export function validConfigurationPreview(v:unknown):v is ConfigurationPreview {
  return keys(v,['commandId','target','action','reason','configurationRevision','previewDigest','expiresAt','before','after','impact'])&&id(v.commandId)&&validConfigurationTarget(v.target)
    &&v.action===configurationAction(v.target)&&line(v.reason,500,10)&&sha(v.configurationRevision)&&sha(v.previewDigest)&&instant(v.expiresAt)
    &&validConfigurationState(v.target,v.before)&&validConfigurationState(v.target,v.after)&&validConfigurationImpact(v.target,v.impact);
}
export function validConfigurationResult(v:unknown):v is ConfigurationResult {
  return keys(v,['commandId','target','action','configurationRevision','appliedAt','replayed','state'])&&id(v.commandId)&&validConfigurationTarget(v.target)
    &&v.action===configurationAction(v.target)&&sha(v.configurationRevision)&&instant(v.appliedAt)&&typeof v.replayed==='boolean'&&validConfigurationState(v.target,v.state);
}
export function sameConfigurationState(a:ConfigurationState,b:ConfigurationState):boolean {
  const right=b as unknown as Record<string,unknown>;
  return Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>key==='expiresAt'
    ?value===null?right[key]===null:right[key]!==null&&Date.parse(String(value))===Date.parse(String(right[key])):value===right[key]);
}
export function validConfigurationStatus(v:unknown):v is ConfigurationStatus {
  return keys(v,['preview','result','canApplyThisSession'])&&validConfigurationPreview(v.preview)&&typeof v.canApplyThisSession==='boolean'
    &&(v.result===null||(validConfigurationResult(v.result)&&v.result.commandId===v.preview.commandId&&sameConfigurationTarget(v.result.target,v.preview.target)&&v.result.replayed===false&&v.canApplyThisSession===false
      &&sameConfigurationState(v.preview.after,v.result.state)));
}
export function validConfigurationCommands(v:unknown,requestOffset:number):v is ConfigurationCommands {
  return keys(v,['items','nextOffset'])&&Array.isArray(v.items)&&v.items.length<=20&&v.items.every(item=>keys(item,['commandId','expectedDigest','expiresAt','appliedAt'])&&id(item.commandId)&&sha(item.expectedDigest)&&instant(item.expiresAt)&&nullableInstant(item.appliedAt))
    &&new Set(v.items.map(item=>String(item.commandId).toLowerCase())).size===v.items.length
    &&(v.nextOffset===null||(offset(v.nextOffset)&&v.nextOffset===requestOffset+20&&v.items.length===20));
}
