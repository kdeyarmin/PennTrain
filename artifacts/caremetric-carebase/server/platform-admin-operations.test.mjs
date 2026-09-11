import assert from 'node:assert/strict';
import test from 'node:test';
import { projectOperationalRead, readOperations } from './platform-admin-operations.mjs';

const job={jobKey:'synthetic.worker',displayName:'Synthetic worker',description:'Fixture only',schedule:null,executionKind:'worker',isCritical:true,retryMode:'manual',
  lastStatus:'never',lastAttemptAt:null,lastSuccessAt:null,nextExpectedAt:null,lastDurationMs:null,attemptedCount:'9007199254740993',succeededCount:null,failedCount:null,
  hasError:false,isStale:null,killSwitchEnabled:true,killSwitchCanStop:false};
const op={operation:'operations.jobs.list',limit:25,offset:0,search:''};
const page=items=>({items,total:items.length,limit:25,offset:0});
test('operational projections preserve unknown health and exact bigint counts',()=>{
  const actual=projectOperationalRead(page([job]),op);
  assert.equal(actual.items[0].attemptedCount,'9007199254740993');assert.equal(actual.items[0].isStale,null);
  assert.equal(actual.items[0].killSwitchCanStop,false);assert.equal(actual.items[0].lastSuccessAt,null);
});
test('SQL cron startup and connection transitions retain their native status',()=>{
  for(const lastStatus of ['starting','connecting','sending']) {
    const actual=projectOperationalRead(page([{...job,executionKind:'sql_cron',lastStatus}]),op);
    assert.equal(actual.items[0].lastStatus,lastStatus);
  }
});
test('raw logs, inferred counts, unknown statuses and duplicate records are refused',()=>{
  for(const row of [{...job,error_message:'private upstream credential'},{...job,attemptedCount:1},{...job,failedCount:'-1'},
    {...job,lastStatus:'healthy'},{...job,lastSuccessAt:'infinity'}])assert.throws(()=>projectOperationalRead(page([row]),op));
  assert.throws(()=>projectOperationalRead(page([job,job]),op));
  assert.throws(()=>projectOperationalRead({...page([job]),offset:1},op));
});
test('unconfigured rollout is distinct from disabled and current provider state',()=>{
  const row={featureKey:'fixture.feature',displayName:'Fixture',description:'',isActive:true,rolloutMode:'unconfigured',isEnabled:null,owner:null,expiresAt:null,updatedAt:null,
    globalKillSwitch:false,organizationKillSwitchCount:'0'};
  const operation={...op,operation:'operations.releases.list'};
  assert.equal(projectOperationalRead(page([row]),operation).items[0].isEnabled,null);
  assert.throws(()=>projectOperationalRead(page([{...row,isEnabled:false}]),operation));
  assert.throws(()=>projectOperationalRead(page([{...row,organizationKillSwitchCount:null}]),operation));
});
test('audit projection retains non-UUID service subjects and excludes metadata',()=>{
  const row={id:crypto.randomUUID(),action:'synthetic.action',entityType:'synthetic',entityId:null,organizationId:null,actorProfileId:null,actorSubjectId:'system',createdAt:'2026-09-11T12:00:00Z'};
  const operation={...op,operation:'operations.audit.list'};
  assert.equal(projectOperationalRead(page([row]),operation).items[0].actorSubjectId,'system');
  assert.throws(()=>projectOperationalRead(page([{...row,metadata:{private:'value'}}]),operation));
});
test('native read uses original verified session identity and propagates revocation',async()=>{
  const nativeId=crypto.randomUUID(),actor={user_id:crypto.randomUUID(),session_id:crypto.randomUUID(),session_started_at:'2026-09-11T12:00:00Z',assurance_expires_at:'2026-09-11T20:00:00Z'};
  const native={rpc:async(name,args)=>{assert.equal(name,'platform_admin_read_operations');assert.equal(args.p_actor,nativeId);assert.equal(args.p_hub_session,actor.session_id);
    assert.equal(args.p_authentication_method,'app_sms');assert.equal(args.p_session_started_at,'2026-09-11T12:00:00.000Z');return{data:page([job]),error:null};}};
  assert.equal((await readOperations({native,nativeId,actor,authenticationMethod:'app_sms',operation:op})).items.length,1);
  await assert.rejects(readOperations({native:{rpc:async()=>({error:{code:'42501'}})},nativeId,actor,authenticationMethod:'app_sms',operation:op}),error=>error.status===403);
});
