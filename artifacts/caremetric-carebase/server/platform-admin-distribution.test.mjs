import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createLearningDistributionHandler,parseDistributionOperation,projectDistributionData} from './platform-admin-distribution.mjs';
import {readPlatformAdminConfig} from './platform-admin-auth.mjs';
const id=n=>`dd000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const op={domain:'course.distribution.v1',operation:'context',courseId:id(4)};
const env={CAREMETRIC_ADMIN_ENABLED:'true',CAREMETRIC_ADMIN_COMMANDS_ENABLED:'true',HUB_SUPABASE_URL:'https://hub.example.test',
  HUB_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_URL:'https://native.example.test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture',
  CAREMETRIC_ADMIN_IDENTITY_MAP_JSON:JSON.stringify({[id(1)]:id(2)})};
const config=readPlatformAdminConfig(key=>env[key]);
const request=()=>new Request('https://cmcarebase.com/api/learning-admin/distribution',{method:'POST',headers:{authorization:'Bearer cmh_'+'a'.repeat(43),'content-type':'application/json'},body:JSON.stringify(op)});
const draft={courseId:id(4),publicationState:'draft',currentVersionId:null,currentVersionState:null,source:null};
function fixture(){
  const actor={user_id:id(1),role:'platform_admin',method:'sms',session_id:id(3),
    session_started_at:'2026-09-11T14:00:00Z',assurance_expires_at:'2026-09-11T22:00:00Z',app_id:'carebase',operation:op};
  const state={actor,profile:{id:id(2),role:'platform_admin',is_active:true},result:draft,calls:[]};
  const fetcher=async(input,init)=>{
    const url=new URL(String(input));state.calls.push({url,body:init.body?JSON.parse(init.body):null});
    if(url.origin==='https://support-hub-web-production.up.railway.app'){assert.equal(url.pathname,'/api/internal/learning/carebase/authorize');return Response.json(state.actor);}
    if(url.pathname.startsWith('/auth/'))return Response.json({user:{id:id(2)}});
    if(url.pathname==='/rest/v1/profiles')return Response.json([state.profile]);
    assert.equal(url.pathname,'/rest/v1/rpc/get_learning_distribution_context');return Response.json(state.result);
  };
  return {state,handler:createLearningDistributionHandler({config,enabled:true,fetcher,now:()=>new Date('2026-09-11T15:00:00Z')})};
}
test('published source must bind current course, version, status and exact payload hash',()=>{
  const payload=JSON.stringify({contract:'carebase.course.v1',sourceCourseId:id(4),sourceVersionId:id(5),publicationState:'published',sourceVersionState:'published'});
  const value={courseId:id(4),publicationState:'published',currentVersionId:id(5),currentVersionState:'published',source:{payload,sourceRevision:createHash('sha256').update(payload).digest('hex')}};
  assert.deepEqual(projectDistributionData(value,op),value);
  for(const bad of [{...value,currentVersionId:id(6)},{...value,source:{...value.source,sourceRevision:'b'.repeat(64)}},
    {...value,publicationState:'archived'},{...draft,source:value.source},{...draft,currentVersionId:id(5)}])assert.throws(()=>projectDistributionData(bad,op));
  assert.deepEqual(projectDistributionData(draft,op),draft);
  assert.throws(()=>parseDistributionOperation({...op,versionId:id(5)}));
});
test('human distribution resolves the protected actor and original SMS session before native context',async()=>{
  const f=fixture();const response=await f.handler(request());assert.equal(response.status,200);assert.deepEqual((await response.json()).data,draft);
  assert.deepEqual(f.state.calls.at(-1).body,{p_actor:id(2),p_hub_user:id(1),p_hub_session:id(3),p_session_started_at:'2026-09-11T14:00:00Z',
    p_assurance_expires_at:'2026-09-11T22:00:00Z',p_course_id:id(4),p_authentication_method:'app_sms'});
});
test('cross-domain capability and demoted native actor cannot read source',async()=>{
  for(const change of [f=>{f.state.actor.operation={...op,domain:'course.provider.v1'};},f=>{f.state.profile.role='employee';}]){
    const f=fixture();change(f);assert.equal((await f.handler(request())).status,403);
    assert.equal(f.state.calls.some(call=>call.url.pathname.endsWith('get_learning_distribution_context')),false);
  }
});
test('large escaped published material uses its narrow source RPC byte allowance',async()=>{
  const f=fixture();
  const payload=JSON.stringify({contract:'carebase.course.v1',sourceCourseId:id(4),sourceVersionId:id(5),publicationState:'published',
    sourceVersionState:'published',content:'"'.repeat(700000)});
  f.state.result={courseId:id(4),publicationState:'published',currentVersionId:id(5),currentVersionState:'published',
    source:{payload,sourceRevision:createHash('sha256').update(payload).digest('hex')}};
  assert.ok(Buffer.byteLength(payload)<2000000);assert.ok(Buffer.byteLength(JSON.stringify(f.state.result))>2097152);
  const response=await f.handler(request());assert.equal(response.status,200);assert.equal((await response.json()).data.source.payload,payload);
});
