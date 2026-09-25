import assert from 'node:assert/strict';
import test from 'node:test';
import {createPlatformConfigurationHandler,parseConfigurationOperation,projectConfigurationResult} from './platform-admin-configuration.mjs';
import {createPlatformAdminCommandHandler} from './platform-admin-commands.mjs';
import {readPlatformAdminConfig} from './platform-admin-auth.mjs';
import {validConfigurationStatus} from '../../../supabase/functions/_shared/operationalConfiguration.ts';
const id=n=>`acd00000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const domain='operations.config.v1',target={kind:'release',featureKey:'test.release'};
const parameters={rolloutMode:'global',isEnabled:true,owner:'Operations',expiresAt:null};
const reason='Reviewed operational configuration';
const impact={kind:'feature',definitionActive:true,organizationName:null,globalKillSwitchActive:false,
  organizationKillSwitchCount:'9007199254740993',retainedCohortCount:'2',retainedMembershipCount:'9223372036854775807',nextBoundaryAt:null};
const before={configured:false,rolloutMode:null,isEnabled:null,owner:null,expiresAt:null,changeReason:null};
const after={configured:true,rolloutMode:'global',isEnabled:true,owner:'Operations',expiresAt:null,changeReason:reason};
const context={target,displayName:'Test release',configurationRevision:'a'.repeat(64),state:before,impact};
const previewOp={domain,operation:'preview',requestId:id(8),target,configurationRevision:context.configurationRevision,parameters,reason};
const preview={commandId:id(7),target,action:'operations.setReleaseFlag',reason,configurationRevision:context.configurationRevision,
  previewDigest:'b'.repeat(64),expiresAt:'2026-09-11T15:05:00Z',before,after,impact};
const result={commandId:id(7),target,action:'operations.setReleaseFlag',configurationRevision:'c'.repeat(64),appliedAt:'2026-09-11T15:01:00Z',replayed:false,state:after};
const applyOp={domain,operation:'apply',commandId:id(7),expectedDigest:preview.previewDigest};
const env={CAREMETRIC_ADMIN_ENABLED:'true',CAREMETRIC_ADMIN_COMMANDS_ENABLED:'true',HUB_SUPABASE_URL:'https://hub.example.test',
  HUB_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_URL:'https://native.example.test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture',
  CAREMETRIC_ADMIN_IDENTITY_MAP_JSON:JSON.stringify({[id(1)]:id(2)})};
const config=readPlatformAdminConfig(key=>env[key]);
const json=(v,status=200)=>Response.json(v,{status});
const request=(body,headers={})=>new Request('https://cmcarebase.com/api/platform-admin/configuration',{method:'POST',headers:{Authorization:'Bearer a.b.c','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
function fixture(overrides={},factory=createPlatformConfigurationHandler){
  const calls=[],state={actor:{user_id:id(1),role:'platform_admin',aal:'aal2',session_id:id(3),session_started_at:'2026-09-11T14:00:00Z',assurance_expires_at:'2026-09-11T22:00:00Z'},
    profile:{id:id(2),role:'platform_admin',is_active:true},user:{id:id(2)},result:context,...overrides};
  const fetcher=async(input,init)=>{
    const url=new URL(String(input));calls.push({url,body:init.body?JSON.parse(init.body):null});assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
    if(url.origin==='https://support-hub-web-production.up.railway.app'){assert.equal(url.pathname,'/api/internal/command/carebase/authorize');return json(state.actor);}
    if(url.origin===env.HUB_SUPABASE_URL){assert.equal(url.pathname,'/rest/v1/rpc/authorize_platform_command');return json(state.actor);}
    if(url.pathname.startsWith('/auth/'))return json({user:state.user});
    if(url.pathname==='/rest/v1/profiles')return json([state.profile]);
    return state.rpcError?json({code:state.rpcError,message:'private provider detail'},400):json(state.result);
  };
  return {calls,state,handler:factory({config,fetcher,now:()=>new Date('2026-09-11T15:00:00Z')})};
}
test('operational targets and settings are a closed existing-resource contract',()=>{
  for(const t of [target,{kind:'job',jobKey:'test-job'},{kind:'featureKill',featureKey:'test.feature',organizationId:id(9)},{kind:'featureKill',featureKey:'test.feature',organizationId:null}]){
    assert.deepEqual(parseConfigurationOperation({domain,operation:'context',target:t}).target,t);
  }
  for(const op of [previewOp,applyOp,{...applyOp,operation:'status'},{domain,operation:'commands',target,offset:20}])assert.deepEqual(parseConfigurationOperation(op),op);
  for(const op of [{...previewOp,domain:'course.provider.v1'},{...previewOp,actor:id(9)},{...previewOp,parameters:{...parameters,rolloutMode:'cohort'}},
    {...previewOp,parameters:{...parameters,isEnabled:false}},{...previewOp,parameters:{...parameters,owner:' ' }},
    {...previewOp,parameters:{...parameters,expiresAt:'tomorrow'}},{...previewOp,target:{kind:'job',jobKey:'test',dispatch:true}},
    {...previewOp,target:{kind:'featureKill',featureKey:'test',organizationId:'all'}},{...previewOp,reason:'reason\u0001hidden'},
    {domain,operation:'commands',target,offset:10001}])assert.throws(()=>parseConfigurationOperation(op));
});
test('configuration previews preserve exact scope, absence and decimal impact',()=>{
  assert.deepEqual(projectConfigurationResult(preview,previewOp),preview);
  for(const value of [{...preview,target:{...target,featureKey:'another'}},{...preview,after:{...after,owner:'Other owner'}},
    {...preview,after:{...after,isEnabled:false}},{...preview,impact:{...impact,retainedMembershipCount:9007199254740993}},
    {...preview,impact:{...impact,retainedMembershipCount:'9223372036854775808'}},{...preview,secret:'hidden'}])assert.throws(()=>projectConfigurationResult(value,previewOp));
  assert.deepEqual(projectConfigurationResult(context,{domain,operation:'context',target}),context);
});
test('preview represents clearing as absence while preserving history and existing cohort state',()=>{
  const killTarget={kind:'featureKill',featureKey:'test.feature',organizationId:null};
  const op={...previewOp,target:killTarget,parameters:{isDisabled:false,expiresAt:null}};
  const value={...preview,target:killTarget,action:'operations.setFeatureKillSwitch',before:{configured:true,isDisabled:true,reason:'Old reason',expiresAt:'2026-09-12T00:00:00Z'},after:{configured:false,isDisabled:false,reason:null,expiresAt:null}};
  assert.deepEqual(projectConfigurationResult(value,op),value);
  assert.throws(()=>projectConfigurationResult({...value,after:{...value.after,configured:true}},op));
  assert.deepEqual(projectConfigurationResult({...preview,before:{...after,rolloutMode:'cohort'}},previewOp).before.rolloutMode,'cohort');
});
test('saved status is immutable observation and cannot smuggle a changed result or apply grant',()=>{
  const op={...applyOp,operation:'status'},status={preview,result,canApplyThisSession:false};
  assert.deepEqual(projectConfigurationResult(status,op),status);
  for(const v of [{...status,canApplyThisSession:true},{...status,result:{...result,replayed:true}},{...status,result:{...result,state:{...after,owner:'Hidden change'}}}])assert.equal(validConfigurationStatus(v),false);
  assert.throws(()=>projectConfigurationResult({...status,preview:{...preview,previewDigest:'d'.repeat(64)}},op));
  const items=Array.from({length:20},(_,i)=>({commandId:id(i+10),expectedDigest:preview.previewDigest,expiresAt:preview.expiresAt,appliedAt:null}));
  assert.deepEqual(projectConfigurationResult({items,nextOffset:20},{domain,operation:'commands',target,offset:0}),{items,nextOffset:20});
  assert.throws(()=>projectConfigurationResult({items:items.slice(0,1),nextOffset:20},{domain,operation:'commands',target,offset:0}));
});
test('actual Supabase client transports the original session, mapped actor and closed target',async()=>{
  const f=fixture({result:preview}),response=await f.handler(request(previewOp));assert.equal(response.status,200);assert.deepEqual(await response.json(),preview);
  assert.equal(f.calls.at(-1).url.pathname,'/rest/v1/rpc/preview_operational_configuration_command');
  assert.equal(f.calls.at(-1).body.p_actor,id(2));assert.equal(f.calls.at(-1).body.p_hub_session,id(3));assert.equal(f.calls.at(-1).body.p_authentication_method,'jwt_aal2');
  assert.deepEqual(f.calls.at(-1).body.p_target,target);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('SMS configuration and ordinary command capabilities cannot cross endpoints',async()=>{
  const actor={user_id:id(1),role:'platform_admin',method:'sms',session_id:id(3),session_started_at:'2026-09-11T14:00:00Z',assurance_expires_at:'2026-09-11T22:00:00Z'};
  const bare={operation:'apply',commandId:id(7),expectedDigest:preview.previewDigest},headers={Authorization:'Bearer cmh_'+'a'.repeat(43)};
  const wrong=fixture({actor:{...actor,operation:bare},result});assert.equal((await wrong.handler(request(applyOp,headers))).status,403);
  const inverse=fixture({actor:{...actor,operation:applyOp},result},createPlatformAdminCommandHandler);assert.equal((await inverse.handler(request(bare,headers))).status,403);
  const good=fixture({actor:{...actor,operation:applyOp},result});assert.equal((await good.handler(request(applyOp,headers))).status,200);assert.equal(good.calls.at(-1).body.p_authentication_method,'app_sms');
});
test('every context and receipt checks current native usability and bounded original authority',async()=>{
  const op={domain,operation:'context',target};
  for(const change of [{profile:{id:id(2),role:'employee',is_active:true}},{profile:{id:id(2),role:'platform_admin',is_active:false}},
    {user:{id:id(2),banned_until:'2026-09-12T00:00:00Z'}},{actor:{user_id:id(1),role:'platform_admin',aal:'aal2',session_id:id(3),session_started_at:'2026-09-10T00:00:00Z',assurance_expires_at:'2026-09-12T00:00:00Z'}}])assert.equal((await fixture(change).handler(request(op))).status,403);
  assert.equal((await fixture().handler(request(op,{Origin:'https://cmcarebase.com'}))).status,403);
});
test('disabled configuration cannot call upstream and database errors reveal only categories',async()=>{
  const disabled=createPlatformConfigurationHandler({config:{...config,commandsEnabled:false},fetcher:()=>{throw new Error('unexpected');}});
  assert.equal((await disabled(request(previewOp))).status,503);
  const response=await fixture({rpcError:'40001'}).handler(request(previewOp));assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:{code:'conflict'}});
});
