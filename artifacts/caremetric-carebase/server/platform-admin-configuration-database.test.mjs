import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import test from 'node:test';
import {createClient} from '@supabase/supabase-js';

test('actual configuration SQL serializes replay and rechecks expiry after a blocking source lock',{
  skip:process.env.CAREMETRIC_LOCAL_COMMAND_TESTS!=='true',timeout:45_000,
},async()=>{
  const url=new URL(process.env.SUPABASE_URL??'');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Configuration fixtures require disposable loopback Supabase');
  const native=createClient(url.origin,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const sql=input=>execFileSync('docker',['exec','-i','supabase_db_xsqobvvreaovwibxwyvv','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  const user=await native.auth.admin.createUser({email:`configuration-${randomUUID()}@fixture.test`,email_confirm:true,password:randomUUID()+'Aa1!'});assert.equal(user.error,null);
  const actor=user.data.user.id;assert.equal((await native.rpc('admin_update_profile',{p_user_id:actor,p_role:'platform_admin',p_is_active:true})).error,null);
  const feature='fixture.configuration.'+randomUUID(),target={kind:'release',featureKey:feature};
  sql(`insert into public.feature_definitions(feature_key,display_name,description,value_type,default_value) values('${feature}','Configuration concurrency fixture','Synthetic configuration','boolean','false');`);
  const started=new Date(Date.now()-60_000),authority={p_actor:actor,p_hub_user:randomUUID(),p_hub_session:randomUUID(),p_authentication_method:'app_sms',
    p_session_started_at:started.toISOString(),p_assurance_expires_at:new Date(started.getTime()+480*60_000).toISOString()};
  const context=await native.rpc('get_operational_configuration',{...authority,p_target:target});assert.equal(context.error,null);
  const request={...authority,p_request_id:randomUUID(),p_target:target,p_configuration_revision:context.data.configurationRevision,
    p_parameters:{rolloutMode:'global',isEnabled:true,owner:'Fixture operations',expiresAt:null},p_reason:'Reviewed concurrency fixture'};
  const previews=await Promise.all(Array.from({length:4},()=>native.rpc('preview_operational_configuration_command',request)));
  for(const p of previews)assert.equal(p.error,null,`Preview error ${p.error?.code??''}`);
  assert.equal(new Set(previews.map(p=>p.data.commandId)).size,1,'one request creates one immutable review');
  const preview=previews[0].data,apply={...authority,p_command_id:preview.commandId,p_expected_digest:preview.previewDigest};
  const results=await Promise.all(Array.from({length:8},()=>native.rpc('apply_operational_configuration_command',apply)));
  for(const r of results)assert.equal(r.error,null,`Apply error ${r.error?.code??''}`);
  assert.equal(results.filter(r=>!r.data.replayed).length,1);assert.equal(results.filter(r=>r.data.replayed).length,7);
  assert.equal(new Set(results.map(r=>r.data.appliedAt)).size,1);
  assert.equal(sql(`select count(*) from public.audit_logs where action='platform_operational_configuration_applied' and entity_id='${preview.commandId}'`),'1');
  const current=await native.rpc('get_operational_configuration',{...authority,p_target:target});assert.equal(current.error,null);
  const deadline=Date.now()+4_000,expiring={...authority,p_assurance_expires_at:new Date(deadline).toISOString()};
  const queued=await native.rpc('preview_operational_configuration_command',{...request,...expiring,p_request_id:randomUUID(),p_configuration_revision:current.data.configurationRevision,
    p_parameters:{rolloutMode:'off',isEnabled:false,owner:'Fixture operations',expiresAt:null}});assert.equal(queued.error,null);
  const locker=spawn('docker',['exec','-i','supabase_db_xsqobvvreaovwibxwyvv','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt'],{stdio:['pipe','pipe','pipe']});
  let output='',failure='',pending;
  locker.stdout.on('data',chunk=>{output+=chunk;});locker.stderr.on('data',chunk=>{failure+=chunk;});
  const exited=new Promise((resolve,reject)=>{locker.once('exit',code=>code===0?resolve():reject(new Error(`Fixture lock process failed: ${failure}`)));locker.once('error',reject);});
  try{
    locker.stdin.write(`begin; select 1 from public.feature_definitions where feature_key='${feature}' for update; select 'LOCK_HELD';\n`);
    const holdLimit=Date.now()+2_000;
    while(!output.includes('LOCK_HELD')&&Date.now()<holdLimit)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(output.includes('LOCK_HELD'),'independent transaction holds configuration lock');
    pending=native.rpc('apply_operational_configuration_command',{...expiring,p_command_id:queued.data.commandId,p_expected_digest:queued.data.previewDigest}).then(value=>value);
    let blocked=false;
    while(Date.now()<deadline-250){
      blocked=Number(sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%apply_operational_configuration_command%'"))>0;
      if(blocked)break;
      await new Promise(resolve=>setTimeout(resolve,15));
    }
    assert.equal(blocked,true,'apply begins under fresh authority, then actually blocks on the source lock');
    await new Promise(resolve=>setTimeout(resolve,Math.max(1,deadline-Date.now()+150)));
    locker.stdin.end('commit;\n');await exited;
    const denied=await pending;
    // The preview and its original authority expire together. The public RPC may
    // report either the expired review or current-authority rejection; neither
    // permits the blocked write. The state and immutable receipt assertions
    // below verify the substantive boundary independently of error precedence.
    assert.ok(['40001','42501'].includes(denied.error?.code),'expired review or authority must be rejected after waiting for the source');
    assert.equal(sql(`select rollout_mode from public.release_flags where feature_key='${feature}'`),'global','blocked expired review cannot mutate configuration');
    const status=await native.rpc('get_operational_configuration_command_status',{...authority,p_hub_session:randomUUID(),p_command_id:queued.data.commandId,p_expected_digest:queued.data.previewDigest});
    assert.equal(status.error,null);assert.equal(status.data.result,null);assert.equal(status.data.canApplyThisSession,false);
  }finally{
    if(!locker.stdin.writableEnded)locker.stdin.end('rollback;\n');
    await exited.catch(()=>{});if(pending)await pending;
  }
});
