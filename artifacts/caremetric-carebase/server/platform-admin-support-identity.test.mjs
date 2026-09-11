import assert from "node:assert/strict";
import test from "node:test";
import { createPlatformAdminHandler, readPlatformAdminConfig } from "./platform-admin.mjs";

const hub="11111111-1111-4111-8111-111111111111", admin="22222222-2222-4222-8222-222222222222";
const user="33333333-3333-4333-8333-333333333333", org="44444444-4444-4444-8444-444444444444";
const now="2026-09-11T20:00:00.000Z";
const operation={operation:"support.identity.resolve",sourceUserId:user,sourceAccountId:org};
const config=readPlatformAdminConfig(name=>({CAREMETRIC_ADMIN_ENABLED:"true",HUB_SUPABASE_URL:"https://hub.example.test",
  HUB_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture",SUPABASE_URL:"https://native.example.test",SUPABASE_SERVICE_ROLE_KEY:"sb_secret_fixture",
  CAREMETRIC_ADMIN_IDENTITY_MAP_JSON:JSON.stringify({[hub]:admin})})[name]);
function fixture() {
  const calls=[], state={actor:{user_id:hub,role:"platform_admin",method:"sms",operation},
    admin:{id:admin,role:"platform_admin",is_active:true},adminAuth:{id:admin,is_anonymous:false},
    profile:{id:user,organization_id:org,role:"employee",is_active:true,updated_at:now},
    organization:{id:org,subscription_status:"active",updated_at:now},user:{id:user,is_anonymous:false,banned_until:null}};
  const fetcher=async(input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);calls.push({url,method:init.method??'GET'});
    assert.equal(init.redirect,"error");assert.ok(init.signal instanceof AbortSignal);
    const json=value=>Response.json(value);
    if(url.origin==="https://support-hub-web-production.up.railway.app"){
      assert.equal(url.pathname,"/api/internal/admin/authorize");return json(state.actor);
    }
    assert.equal(url.origin,"https://native.example.test");
    assert.equal(new Headers(init.headers).get("apikey"),"sb_secret_fixture");
    if(url.pathname===`/auth/v1/admin/users/${admin}`)return json({user:state.adminAuth});
    if(url.pathname===`/auth/v1/admin/users/${user}`)return json({user:state.user});
    if(url.pathname==="/rest/v1/profiles"){
      if(url.searchParams.get("id")===`eq.${admin}`){assert.equal(url.searchParams.get("select"),"id,role,is_active");return json(state.admin?[state.admin]:[]);}
      assert.equal(url.searchParams.get("id"),`eq.${user}`);assert.equal(url.searchParams.get("organization_id"),`eq.${org}`);
      assert.equal(url.searchParams.get("select"),"id,organization_id,role,is_active,updated_at");return json(state.profile?[state.profile]:[]);
    }
    assert.equal(url.pathname,"/rest/v1/organizations");assert.equal(url.searchParams.get("id"),`eq.${org}`);
    assert.equal(url.searchParams.get("select"),"id,subscription_status,updated_at");return json(state.organization?[state.organization]:[]);
  };
  const handler=createPlatformAdminHandler({config,fetcher,now:()=>new Date(now)});
  const call=(body=operation,headers={})=>handler(new Request("https://cmcarebase.com/api/platform-admin/read",{method:"POST",
    headers:{Authorization:`Bearer cmh_${"a".repeat(43)}`,"Content-Type":"application/json",...headers},body:JSON.stringify(body)}));
  return {state,calls,call};
}
test("exact native account and organization yield a bounded proof without credentials or employee records",async()=>{
  const f=fixture(),response=await f.call();assert.equal(response.status,200);
  const body=await response.json();assert.deepEqual(Object.keys(body.data).sort(),["accountKind","product","relationship","revision","sourceAccountId","sourceUserId"]);
  assert.deepEqual({...body.data,revision:undefined},{sourceUserId:user,sourceAccountId:org,product:"carebase",accountKind:"organization",relationship:"organization_member",revision:undefined});
  assert.match(body.data.revision,/^[a-f0-9]{64}$/);assert.equal(body.data.sourceUserId,user);assert.equal(body.data.sourceAccountId,org);
  assert.ok(f.calls.every(c=>c.method==='GET'||c.url.pathname==='/api/internal/admin/authorize'));
  f.state.profile.updated_at="2026-09-11T20:00:01.000Z";assert.notEqual((await (await f.call()).json()).data.revision,body.data.revision);
});
test("unrelated, inactive, suspended, deleted, anonymous and banned accounts cannot be proved",async()=>{
  for(const change of [s=>s.profile=null,s=>s.profile.organization_id=admin,s=>s.profile.is_active=false,s=>s.profile.role='platform_admin',
    s=>s.organization=null,s=>s.organization.id=admin,s=>s.organization.subscription_status='suspended',s=>s.user=null,s=>s.user.id=admin,
    s=>s.user.is_anonymous=true,s=>s.user.deleted_at=now,s=>s.user.banned_until='2027-01-01T00:00:00Z',s=>s.user.banned_until='invalid']){
    const f=fixture();change(f.state);assert.equal((await f.call()).status,403);
  }
});
test("billing grace, comped and canceled states do not fabricate an inactive customer account",async()=>{
  for(const status of ['trial','active','grace','past_due','canceled','comped']){const f=fixture();f.state.organization.subscription_status=status;assert.equal((await f.call()).status,200);}
});
test("current mapped administrator and exact single-use SMS intent remain mandatory",async()=>{
  for(const change of [s=>s.admin.role='employee',s=>s.admin.is_active=false,s=>s.adminAuth.deleted_at=now,
    s=>s.actor.user_id=user,s=>s.actor.method='email',s=>s.actor.operation={...operation,sourceAccountId:admin}]){
    const f=fixture();change(f.state);assert.equal((await f.call()).status,403);
    assert.ok(!f.calls.some(c=>c.url.pathname==='/rest/v1/organizations'));
  }
});
test("rejects browser origins, arbitrary keys, invalid IDs and malformed proof timestamps",async()=>{
  for(const body of [{...operation,sourceAccountId:'not-an-id'},{...operation,email:'customer@example.test'},{...operation,sourceUserId:null}]){
    const f=fixture();assert.equal((await f.call(body)).status,400);assert.equal(f.calls.length,0);
  }
  const f=fixture();assert.equal((await f.call(operation,{Origin:'https://external.example.test'})).status,403);
  f.state.profile.updated_at=null;assert.equal((await f.call()).status,502);
});
