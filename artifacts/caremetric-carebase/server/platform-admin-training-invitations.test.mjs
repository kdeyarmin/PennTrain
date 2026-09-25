import assert from 'node:assert/strict';
import test from 'node:test';
import {executeTrainingInvitation} from './platform-admin-training-invitations.mjs';

const id=n=>`eee00000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const operation={domain:'training.v1',operation:'apply',action:'invitations.create',requestId:id(1),organizationId:id(2),
  parameters:{role:'org_admin',firstName:'Test',lastName:'Administrator',email:'admin@test.invalid',facilityId:null,employeeId:null},reason:'Set up this facility administrator'};
const config={supabaseUrl:'https://native.test',serviceKey:'synthetic-key'};
function fixture(){
  const state={sends:0,checks:0,deletes:0,receipt:null,reservations:0,failAfterSend:false,failFinalize:false,failProvision:false,loseRecordResponse:false,revokeBeforeSend:false,events:[]};
  const actor={user_id:id(3),session_id:id(4),session_started_at:'2026-09-25T00:00:00Z',assurance_expires_at:'2026-09-25T08:00:00Z'};
  function query(table){
    const q={select:()=>q,eq:()=>q,single:async()=>({data:{role:'platform_admin',organization_id:null,is_active:true},error:null}),
      maybeSingle:async()=>({data:{is_demo:false},error:null})};
    assert.ok(['profiles','organizations'].includes(table));return q;
  }
  const native={from:query,auth:{admin:{
    inviteUserByEmail:async(email)=>{state.events.push('send');state.sends++;assert.equal(email,operation.parameters.email);
      if(state.failAfterSend)throw new Error('provider disconnected after accepting mail');
      return {data:{user:{id:id(5),email}},error:null};},
    deleteUser:async()=>{state.deletes++;return {error:null};},
  }},rpc:async(name,args)=>{
    state.events.push(name);
    if(name==='platform_admin_training_invitation_reserve'){
      assert.equal(args.p_actor,id(6));assert.equal(args.p_hub_user,actor.user_id);assert.equal(args.p_authentication_method,'app_sms');
      if(state.receipt){
        if(JSON.stringify(state.original)!==JSON.stringify(args.p_operation))return {error:{code:'40001'}};
        return {data:{execute:false,dispatchToken:null,receipt:{...state.receipt,replayed:true}},error:null};
      }
      state.original=structuredClone(args.p_operation);state.reservations++;
      state.receipt={requestId:args.p_operation.requestId,action:'invitations.create',organizationId:id(2),replayed:false,result:{invitationId:null,deliveryStatus:'unknown'}};
      return {data:{execute:true,dispatchToken:id(7),receipt:state.receipt},error:null};
    }
    if(name==='platform_admin_training_invitation_authorize'){
      state.checks++;assert.equal(args.p_dispatch_token,id(7));assert.deepEqual(args.p_operation,operation);
      return state.revokeBeforeSend&&state.checks===2?{data:false,error:{code:'42501'}}:{data:true,error:null};
    }
    if(name==='platform_admin_training_invitation_finalize'){
      assert.equal(args.p_dispatch_token,id(7));assert.equal(args.p_request_id,operation.requestId);
      if(state.failFinalize)return {error:{code:'XX000'}};
      if(state.receipt.result.deliveryStatus==='sent'&&args.p_invitation_id!==state.receipt.result.invitationId)return {error:{code:'40001'}};
      state.receipt={...state.receipt,result:{invitationId:args.p_invitation_id,deliveryStatus:args.p_invitation_id?'sent':'unknown'}};
      return {data:state.receipt,error:null};
    }
    if(name==='platform_admin_training_invitation_record'){
      assert.equal(args.p_dispatch_token,id(7));assert.equal(args.p_invited_user_id,id(5));
      assert.equal(args.p_redirect_to,'https://cmcarebase.com/reset-password');
      state.receipt={...state.receipt,result:{invitationId:id(8),deliveryStatus:'sent'}};
      if(state.loseRecordResponse)throw new Error('response lost after atomic record commit');
      return {data:state.receipt,error:null};
    }
    if(name==='admin_update_profile')return state.failProvision?{error:{message:'synthetic profile failure'}}:{data:{id:id(5)},error:null};
    if(name==='record_user_invitation_sent'){assert.equal(args.p_created_by,id(6));assert.equal(args.p_invited_role,'org_admin');return {data:id(8),error:null};}
    throw new Error(`Unexpected RPC ${name}`);
  }};
  const authority={native,nativeId:id(6),actor,authenticationMethod:'app_sms'};
  const run=(op=operation)=>executeTrainingInvitation({authority,operation:op,config,getEnv:()=>undefined});
  return {state,run};
}

test('delegated invitation reserves intent before email and exact retry replays one delivery',async()=>{
  const {state,run}=fixture();const result=await run();
  assert.equal(result.result.deliveryStatus,'sent');assert.equal(result.result.invitationId,id(8));
  assert.equal(state.events[0],'platform_admin_training_invitation_reserve');
  assert.equal(state.checks,2);assert.equal(state.sends,1);
  assert.equal((await run()).replayed,true);assert.equal(state.sends,1);assert.equal(state.reservations,1);
  await assert.rejects(run({...operation,parameters:{...operation.parameters,email:'changed@test.invalid'}}),error=>error.status===409);
  assert.equal(state.sends,1);
});
test('provider uncertainty remains observable and never triggers automatic resend',async()=>{
  const {state,run}=fixture();state.failAfterSend=true;
  const first=await run();assert.deepEqual(first.result,{invitationId:null,deliveryStatus:'unknown'});
  assert.deepEqual((await run()).result,first.result);assert.equal(state.sends,1);
});
test('failed unknown finalization leaves the pre-send receipt and retry does not send again',async()=>{
  const {state,run}=fixture();state.failAfterSend=true;state.failFinalize=true;
  await assert.rejects(run(),error=>error.status===503);assert.equal(state.sends,1);
  state.failFinalize=false;const retry=await run();assert.equal(retry.replayed,true);
  assert.equal(retry.result.deliveryStatus,'unknown');assert.equal(state.sends,1);
});
test('lost atomic lifecycle response recovers the exact sent outcome without another email',async()=>{
  const {state,run}=fixture();state.loseRecordResponse=true;
  await assert.rejects(run(),error=>error.status===503&&error.code==='upstream');assert.equal(state.sends,1);assert.equal(state.deletes,0);
  const retry=await run();assert.equal(retry.replayed,true);assert.deepEqual(retry.result,{invitationId:id(8),deliveryStatus:'sent'});
  assert.equal(state.sends,1);assert.equal(state.deletes,0);
});
test('current native authority is rechecked immediately before sending',async()=>{
  const {state,run}=fixture();state.revokeBeforeSend=true;
  assert.equal((await run()).result.deliveryStatus,'unknown');assert.equal(state.sends,0);
  assert.equal((await run()).replayed,true);assert.equal(state.sends,0);
});
test('existing profile provisioning compensation runs and the email attempt is never replayed',async()=>{
  const {state,run}=fixture();state.failProvision=true;
  assert.equal((await run()).result.deliveryStatus,'unknown');assert.equal(state.sends,1);assert.equal(state.deletes,1);
  await run();assert.equal(state.sends,1);assert.equal(state.deletes,1);
});
test('only closed facility-admin and linked-employee invitations can enter the reservation',async()=>{
  const {state,run}=fixture();
  for(const op of [{...operation,parameters:{...operation.parameters,role:'platform_admin'}},
    {...operation,parameters:{...operation.parameters,role:'employee'}},
    {...operation,redirectTo:'https://evil.test'}])await assert.rejects(run(op));
  assert.equal(state.reservations,0);assert.equal(state.sends,0);
});
