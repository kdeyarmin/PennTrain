import assert from "node:assert/strict";
import test from "node:test";
import { createLearningAdminHandler } from "./platform-admin-learning.mjs";
import { readPlatformAdminConfig } from "./platform-admin-auth.mjs";
const id=n=>`abc00000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const env={CAREMETRIC_ADMIN_ENABLED:"true",CAREMETRIC_ADMIN_COMMANDS_ENABLED:"true",HUB_SUPABASE_URL:"https://hub.example.test",HUB_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture",SUPABASE_URL:"https://native.example.test",SUPABASE_SERVICE_ROLE_KEY:"sb_secret_fixture",CAREMETRIC_ADMIN_IDENTITY_MAP_JSON:JSON.stringify({[id(1)]:id(2)})};
const config=readPlatformAdminConfig(key=>env[key]);
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
const request=(body,headers={})=>new Request("https://cmcarebase.com/api/learning-admin/receipt",{method:"POST",headers:{Authorization:"Bearer a.b.c","Content-Type":"application/json",...headers},body:JSON.stringify(body)});
function fixture(overrides={}) {
  const calls=[]; const state={actor:{user_id:id(1),role:"platform_admin",aal:"aal2",session_id:id(3),session_started_at:"2026-09-11T14:00:00Z",assurance_expires_at:"2026-09-11T22:00:00Z"},user:{id:id(2)},profile:{id:id(2),role:"platform_admin",is_active:true},result:null,...overrides};
  const fetcher=async(input,init)=>{
    const url=new URL(String(input)); calls.push({url,body:init.body?JSON.parse(init.body):null}); assert.equal(init.redirect,"error");assert.ok(init.signal instanceof AbortSignal);
    if(url.origin==='https://support-hub-web-production.up.railway.app') {
      assert.equal(url.pathname,'/api/internal/learning/carebase/authorize');return json(state.actor);
    }
    if(url.origin===env.HUB_SUPABASE_URL){assert.equal(url.pathname,"/rest/v1/rpc/authorize_platform_command");return json(state.actor);}
    if(url.pathname.startsWith("/auth/"))return json({user:state.user});
    if(url.pathname==="/rest/v1/profiles")return json([state.profile]);
    return state.rpcError?json({code:state.rpcError,message:"private upstream details"},400):json(state.result);
  };
  return {calls,state,handler:createLearningAdminHandler({config,enabled:true,fetcher,now:()=>new Date("2026-09-11T15:00:00Z")})};
}
test("bridge defaults disabled without making network calls",async()=>{
  const handler=createLearningAdminHandler({config,fetcher:()=>{throw new Error("network forbidden");}});
  assert.equal((await handler(request({operation:"list",limit:1}))).status,503);
});
test("source identity resolver projects only verified identifiers",async()=>{
  const f=fixture({result:{organizationId:id(4),employeeId:id(5),profileId:id(6),email:"private"}});
  const response=await f.handler(request({operation:"resolve_identity",organizationId:id(4),employeeId:id(5)}));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{organizationId:id(4),employeeId:id(5),profileId:id(6)});
  assert.deepEqual(f.calls.at(-1).body,{p_actor_id:id(2),p_authentication_method:'jwt_aal2',p_organization_id:id(4),p_employee_id:id(5)});
});
test("unknown operation fields cannot inject an actor or RPC",async()=>{
  const f=fixture();const response=await f.handler(request({operation:"list",limit:1,p_actor_id:id(99)}));
  assert.equal(response.status,400);assert.ok(f.calls.every(c=>!c.url.pathname.includes("list_learning")));
});
test("origin headers cannot call the private native bridge",async()=>{
  const f=fixture();assert.equal((await f.handler(request({operation:"list",limit:1},{Origin:"https://help.caremetric.ai"}))).status,403);assert.equal(f.calls.length,0);
});
test("expired command session fails before any native receipt RPC",async()=>{
  const f=fixture({actor:{user_id:id(1),role:"platform_admin",aal:"aal2",session_id:id(3),session_started_at:"2026-09-10T14:00:00Z",assurance_expires_at:"2026-09-10T22:00:00Z"}});
  assert.equal((await f.handler(request({operation:"list",limit:1}))).status,403);assert.ok(f.calls.every(c=>!c.url.pathname.includes("list_learning")));
});
test("native administrator revocation and bans prevent delivery",async()=>{
  for(const override of [{profile:{id:id(2),role:"platform_admin",is_active:false}},{user:{id:id(2),banned_until:"2026-09-12T00:00:00Z"}}]){
    const f=fixture(override);assert.equal((await f.handler(request({operation:"list",limit:1}))).status,403);assert.ok(f.calls.every(c=>!c.url.pathname.includes("list_learning")));
  }
});
test("delivery batch is bounded and strips extra private fields",async()=>{
  const row={eventId:id(7),payload:"{}",sourceDigest:"a".repeat(64),state:"pending",reason:null,private:"must drop"};
  const f=fixture({result:[row]});const response=await f.handler(request({operation:"list",limit:1}));assert.equal(response.status,200);assert.ok(!(await response.text()).includes("must drop"));
  f.state.result=[row,row];assert.equal((await f.handler(request({operation:"list",limit:1}))).status,502);
});
test("ACK forwards only actor/event/digest and sanitizes conflicts",async()=>{
  const f=fixture();let response=await f.handler(request({operation:"acknowledge",eventId:id(7),sourceDigest:"a".repeat(64)}));assert.equal(response.status,200);
  assert.deepEqual(f.calls.at(-1).body,{p_actor_id:id(2),p_authentication_method:'jwt_aal2',p_event_id:id(7),p_source_digest:"a".repeat(64)});
  f.state.rpcError="40001";response=await f.handler(request({operation:"acknowledge",eventId:id(7),sourceDigest:"a".repeat(64)}));assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:{code:"conflict"}});
});
test("SMS uses the dedicated learning audience and records its actual method",async()=>{
  const operation={operation:'acknowledge',eventId:id(7),sourceDigest:'a'.repeat(64)};
  const f=fixture();f.state.actor={...f.state.actor,method:'sms',operation};delete f.state.actor.aal;
  const response=await f.handler(request(operation,{Authorization:`Bearer cmh_${'x'.repeat(43)}`}));
  assert.equal(response.status,200);assert.equal(f.calls.at(-1).body.p_authentication_method,'app_sms');
  assert.equal(f.calls[0].url.pathname,'/api/internal/learning/carebase/authorize');
});
test("an SMS ticket for a different learning operation cannot mutate the outbox",async()=>{
  const f=fixture();f.state.actor={...f.state.actor,method:'sms',operation:{operation:'list',limit:1}};delete f.state.actor.aal;
  assert.equal((await f.handler(request({operation:'revoke',mappingId:id(7)},{Authorization:`Bearer cmh_${'x'.repeat(43)}`}))).status,403);
  assert.equal(f.calls.length,1);
});
