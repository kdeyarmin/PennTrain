import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createPlatformTrainingHandler, projectTrainingResponse } from './platform-admin-training.mjs';
import { readPlatformAdminConfig } from './platform-admin-auth.mjs';
import { parseTrainingOperation } from '../../../supabase/functions/_shared/trainingProtocol.ts';
const id = n => `ce250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const domain = 'training.v1';
const env = { CAREMETRIC_ADMIN_ENABLED:'true',CAREMETRIC_ADMIN_COMMANDS_ENABLED:'true',HUB_SUPABASE_URL:'https://hub.example.test',
  HUB_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_URL:'https://native.example.test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture',
  CAREMETRIC_ADMIN_IDENTITY_MAP_JSON:JSON.stringify({[id(1)]:id(2)}) };
const config = readPlatformAdminConfig(key => env[key]);
const now = () => new Date('2026-09-25T12:00:00Z');
const request = (body, headers = {}) => new Request('https://cmcarebase.com/api/platform-admin/training', {method:'POST',headers:{Authorization:'Bearer a.b.c','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const list = {domain,operation:'facilities.list',organizationId:id(4),limit:25,offset:0,search:''};
const facilities = {items:[{id:id(5),name:'Test home',facilityType:'PCH',isActive:true}],total:1,limit:25,offset:0};
function fixture(overrides={}) {
 const calls=[],state={actor:{user_id:id(1),role:'platform_admin',aal:'aal2',session_id:id(3),session_started_at:'2026-09-25T11:00:00Z',assurance_expires_at:'2026-09-25T19:00:00Z'},
  profile:{id:id(2),role:'platform_admin',is_active:true},user:{id:id(2)},result:facilities,...overrides};
 const fetcher=async(input,init)=>{
  const url=new URL(String(input));calls.push({url,body:init.body?JSON.parse(init.body):null});assert.equal(init.redirect,'error');
  if(url.origin==='https://support-hub-web-production.up.railway.app'){assert.equal(url.pathname,'/api/internal/command/carebase/authorize');return Response.json(state.actor);}
  if(url.origin===env.HUB_SUPABASE_URL){assert.equal(url.pathname,'/rest/v1/rpc/authorize_platform_command');return Response.json(state.actor);}
  if(url.pathname.startsWith('/auth/'))return Response.json({user:state.user});
  if(url.pathname==='/rest/v1/profiles')return Response.json([state.profile]);
  if(url.pathname.startsWith('/storage/'))return Response.json({signedURL:state.signedURL??`/object/sign/certificates/${id(4)}/${id(8)}.pdf?token=safe`});
  return state.rpcError?Response.json({code:state.rpcError,message:'Private upstream detail'}, {status:400}):Response.json(state.result);
 };
 return {calls,state,handler:createPlatformTrainingHandler({config,fetcher,now,createClient:state.createClient})};
}
test('training reads transmit mapped native actor and original fresh Hub session, never native claims',async()=>{
 const f=fixture(),r=await f.handler(request(list));assert.equal(r.status,200);assert.deepEqual(await r.json(),facilities);
 const last=f.calls.at(-1);assert.equal(last.url.pathname,'/rest/v1/rpc/platform_admin_training');assert.equal(last.body.p_actor,id(2));
 assert.equal(last.body.p_hub_session,id(3));assert.equal(last.body.p_authentication_method,'jwt_aal2');assert.deepEqual(last.body.p_operation,list);
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('closed training contract rejects missing scope, hostile actors, extra fields and invalid dates',async()=>{
 const command={domain,operation:'apply',requestId:id(9),action:'students.create',organizationId:id(4),reason:'Create a new training student',
  parameters:{facilityId:id(5),firstName:'Test',lastName:'Student',email:null,jobTitle:'Aide',hireDate:'2026-09-25'}};
 assert.deepEqual(parseTrainingOperation(command),command);
 for(const op of [{...list,organizationId:null},{...list,actorId:id(2)},{...list,limit:101},
  {...command,parameters:{...command.parameters,profileId:id(2)}},{...command,parameters:{...command.parameters,hireDate:'2026-02-30'}},
  {...command,action:'students.delete'}]){
  const f=fixture();assert.equal((await f.handler(request(op))).status,400);assert.equal(f.calls.length,0);
 }
});
test('native mapping, current role, bans and original MFA lifetime are checked on every read',async()=>{
 for(const change of [{profile:{id:id(2),role:'employee',is_active:true}},{profile:{id:id(2),role:'platform_admin',is_active:false}},
  {user:{id:id(2),banned_until:'2026-09-26T00:00:00Z'}},{actor:{user_id:id(1),role:'platform_admin',aal:'aal2',session_id:id(3),session_started_at:'2026-09-24T01:00:00Z',assurance_expires_at:'2026-09-26T00:00:00Z'}}]){
  const f=fixture(change);assert.equal((await f.handler(request(list))).status,403);assert.ok(!f.calls.some(c=>c.url.pathname==='/rest/v1/rpc/platform_admin_training'));
 }
 assert.equal((await fixture().handler(request(list,{Origin:'https://cmcarebase.com'}))).status,403);
});
test('operation-bound SMS tickets cannot change the facility or cross command/read audiences',async()=>{
 const actor={user_id:id(1),role:'platform_admin',method:'sms',session_id:id(3),session_started_at:'2026-09-25T11:00:00Z',assurance_expires_at:'2026-09-25T19:00:00Z'};
 const headers={Authorization:'Bearer cmh_'+'a'.repeat(43)};
 const wrong=fixture({actor:{...actor,operation:{...list,organizationId:id(99)}}});assert.equal((await wrong.handler(request(list,headers))).status,403);
 const good=fixture({actor:{...actor,operation:list}});assert.equal((await good.handler(request(list,headers))).status,200);
 assert.equal(good.calls.at(-1).body.p_authentication_method,'app_sms');
});
test('ready certificate downloads sign only the scoped native private certificate path',async()=>{
 const op={domain,operation:'certificates.read',organizationId:id(4),certificateId:id(8)};
 const result={certificateId:id(8),status:'ready',url:null,expiresAt:null,_storageBucket:'certificates',_storagePath:`${id(4)}/${id(8)}.pdf`};
 const good=fixture({result}),r=await good.handler(request(op));assert.equal(r.status,200);const value=await r.json();
 assert.equal(value.url,`https://native.example.test/storage/v1/object/sign/certificates/${id(4)}/${id(8)}.pdf?token=safe`);
 assert.equal(value.expiresAt,'2026-09-25T12:10:00.000Z');assert.equal(value._storagePath,undefined);
 for(const bad of [{...result,_storagePath:`${id(9)}/${id(8)}.pdf`},{...result,_storageBucket:'resident-documents'},{...result,certificateId:id(9)}]){
  const f=fixture({result:bad});assert.equal((await f.handler(request(op))).status,502);assert.ok(!f.calls.some(c=>c.url.pathname.startsWith('/storage/')));
 }
 assert.equal((await fixture({result,signedURL:'https://attacker.test/object/sign/certificates/x?token=secret'}).handler(request(op))).status,502);
 const pending=fixture({result:{...result,status:'pending',_storageBucket:null,_storagePath:null}});
 assert.deepEqual(await (await pending.handler(request(op))).json(),{certificateId:id(8),status:'pending',url:null,expiresAt:null});
});
test('large enrollment export uses one bounded database request and rejects partial results',async()=>{
 const op={domain,operation:'enrollments.report',organizationId:id(4),facilityId:null,courseSearch:'',status:'all',dateBasis:'assigned',dateFrom:null,dateThrough:null,limit:10000,offset:0};
 const row=n=>({id:id(100+n),employee_id:id(6),student:'Student '.repeat(50),facility_id:id(5),facility:'Test facility',course_id:id(7),course:'Assigned original title',status:'assigned',assigned_at:'2026-09-25T12:00:00Z',due_date:null,completed_at:null,percent_complete:0,certificate_id:null,credential_number:null,certificate_issued_at:null,certificate_pdf_status:null});
 const result={organization_name:'Customer',facility_name:null,generated_at:'2026-09-25T12:00:00Z',date_basis:'assigned',limit:10000,offset:0,total:4000,students:1,completed:0,in_progress:0,not_started:4000,canceled:0,completion_denominator:4000,certificates:0,rows:Array.from({length:4000},(_,n)=>row(n))};
 assert.ok(Buffer.byteLength(JSON.stringify(result))>2*1024*1024);
 const f=fixture({result}),response=await f.handler(request(op));assert.equal(response.status,200);assert.equal((await response.json()).rows.length,4000);
 assert.equal(f.calls.filter(c=>c.url.pathname==='/rest/v1/rpc/platform_admin_training').length,1);
 assert.equal((await fixture({result:{...result,rows:result.rows.slice(0,1000)}}).handler(request(op))).status,502);
 const large=await fixture({rpcError:'54000'}).handler(request(op));assert.equal(large.status,413);assert.deepEqual(await large.json(),{error:{code:'report_too_large'}});
});
test('mutation receipts are projected to the requested target and errors disclose only categories',async()=>{
 const op={domain,operation:'apply',requestId:id(9),action:'students.update',organizationId:id(4),reason:'Correct student training roster details',parameters:{employeeId:id(6),firstName:'Test',lastName:'Student',email:null,jobTitle:'Aide'}};
 const result={requestId:id(9),action:op.action,organizationId:id(4),replayed:true,result:{employeeId:id(6),secret:'private'}};
 const good=await fixture({result}).handler(request(op));assert.equal(good.status,200);assert.equal((await good.json()).result.secret,undefined);
 assert.equal((await fixture({result:{...result,result:{employeeId:id(7)}}}).handler(request(op))).status,502);
 const conflict=await fixture({rpcError:'40001'}).handler(request(op));assert.equal(conflict.status,409);assert.deepEqual(await conflict.json(),{error:{code:'conflict'}});
});

test('valid reports below the enrollment cap report their byte cap at both upstream and projected boundaries',async()=>{
 const op={domain,operation:'enrollments.report',organizationId:id(4),facilityId:null,courseSearch:'',status:'all',dateBasis:'assigned',dateFrom:null,dateThrough:null,limit:10000,offset:0};
 const rows=Array.from({length:3000},(_,n)=>({id:id(100+n),employee_id:id(6),student:'學'.repeat(400),facility_id:id(5),facility:'院'.repeat(400),course_id:id(7),course:'訓'.repeat(900),status:'assigned',assigned_at:'2026-09-25T12:00:00Z',due_date:null,completed_at:null,percent_complete:0,certificate_id:null,credential_number:null,certificate_issued_at:null,certificate_pdf_status:null}));
 const result={organization_name:'Customer',facility_name:null,generated_at:'2026-09-25T12:00:00Z',date_basis:'assigned',limit:10000,offset:0,total:rows.length,students:1,completed:0,in_progress:0,not_started:rows.length,canceled:0,completion_denominator:rows.length,certificates:0,rows};
 assert.ok(rows.length<10000);
 assert.ok(Buffer.byteLength(JSON.stringify(projectTrainingResponse(result,op)))>12_000_000);
 const streamed=fixture({result}),streamedResponse=await streamed.handler(request(op));
 assert.equal(streamedResponse.status,413);assert.deepEqual(await streamedResponse.json(),{error:{code:'report_too_large'}});
 assert.equal(streamed.calls.filter(c=>c.url.pathname==='/rest/v1/rpc/platform_admin_training').length,1);
 // Bypass only the RPC transport to independently exercise the serialized projection guard.
 const createClient=(url,key,options)=>{
   const client=createSupabaseClient(url,key,options),rpc=client.rpc.bind(client);
   client.rpc=(name,args)=>name==='platform_admin_training'?Promise.resolve({data:result,error:null}):rpc(name,args);
   return client;
 };
 const projected=await fixture({createClient}).handler(request(op));
 assert.equal(projected.status,413);assert.deepEqual(await projected.json(),{error:{code:'report_too_large'}});
 // Neither roster reads nor the report's identity checks inherit the export limit or category.
 const ordinary=await fixture({result:{...facilities,privateDetail:'x'.repeat(2*1024*1024)}}).handler(request(list));
 assert.equal(ordinary.status,503);assert.deepEqual(await ordinary.json(),{error:{code:'upstream'}});
 const authority=await fixture({profile:{id:id(2),role:'platform_admin',is_active:true,privateDetail:'x'.repeat(2*1024*1024)}}).handler(request(op));
 assert.equal(authority.status,503);assert.deepEqual(await authority.json(),{error:{code:'upstream'}});
});
