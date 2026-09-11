import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import test from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {zipSync,unzipSync} from 'fflate';
import {createPlatformPackageHandler} from './platform-admin-packages.mjs';

test('actual local Storage, native package handler and SQL preserve bytes through duplicate, lost-response and revoked-authority recovery',{
 skip:process.env.CAREMETRIC_LOCAL_PACKAGE_TESTS!=='true',timeout:45_000,
},async()=>{
 const url=new URL(process.env.SUPABASE_URL??'');
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Package fixtures require disposable loopback Supabase');
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const native=createClient(url.origin,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const sql=input=>execFileSync('docker',['exec','-i','supabase_db_xsqobvvreaovwibxwyvv','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 const rpc=async(name,args)=>{const result=await native.rpc(name,args);assert.equal(result.error,null,`Synthetic RPC ${name}: ${result.error?.code??''}`);return result.data;};
 const created=await native.auth.admin.createUser({email:`package-${randomUUID()}@fixture.test`,email_confirm:true,password:randomUUID()+'Aa1!'});
 assert.equal(created.error,null);const actor=created.data.user.id;
 await rpc('admin_update_profile',{p_user_id:actor,p_role:'platform_admin',p_is_active:true});
 const course=randomUUID(),version=randomUUID(),hubUser=randomUUID(),hubSession=randomUUID();
 sql(`begin;
 insert into public.courses(id,organization_id,title,status,created_by) values('${course}',null,'Package HTTP fixture','draft','${actor}');
 insert into public.course_versions(id,course_id,organization_id,version_number,title,status) values('${version}','${course}',null,1,'Package HTTP draft','draft');
 commit;`);
 const original=zipSync({'index.html':new TextEncoder().encode('<html><body>Exact authored package fixture</body></html>'),'lesson.txt':new TextEncoder().encode('Original lesson bytes')});
 const sha=createHash('sha256').update(original).digest('hex');
 const tickets=new Map(),storageCalls=[];let loseFinish=false;
 const started=new Date(Date.now()-60_000);
 const authority={user_id:hubUser,role:'platform_admin',method:'sms',session_id:hubSession,session_started_at:started.toISOString(),assurance_expires_at:new Date(started.getTime()+480*60_000).toISOString()};
 const handler=createPlatformPackageHandler({config:{enabled:true,commandsEnabled:true,packageIngestionEnabled:true,
   supabaseUrl:url.origin,serviceKey,identities:new Map([[hubUser,actor]])},createClient,
  fetcher:async(input,init)=>{
   const target=new URL(input instanceof Request?input.url:input);
   if(target.href==='https://support-hub-web-production.up.railway.app/api/internal/learning/carebase/authorize'){
    const ticket=new Headers(init.headers).get('authorization'),operation=tickets.get(ticket);tickets.delete(ticket);
    return operation?Response.json({...authority,operation}):Response.json({},{status:401});
   }
   assert.equal(target.origin,url.origin,'Fixture cannot contact an external service');
   const response=await fetch(input,init);
   if(target.pathname.startsWith('/storage/'))storageCalls.push({method:init?.method??'GET',status:response.status});
   if(loseFinish&&target.pathname==='/rest/v1/rpc/finish_delegated_learning_package_operation'){
    loseFinish=false;await response.arrayBuffer();throw new Error('Synthetic committed response lost');
   }
   return response;
  }});
 const send=operation=>{
  const ticket=`Bearer cmh_${randomBytes(32).toString('base64url')}`;tickets.set(ticket,operation);
  return handler(new Request('https://cmcarebase.com/api/learning-admin/package',{method:'POST',
   headers:{authorization:ticket,...(operation.operation==='upload'?{'content-type':'application/zip','x-caremetric-package-request':Buffer.from(JSON.stringify(operation)).toString('base64url')}:{'content-type':'application/json'})},
   body:operation.operation==='upload'?original:JSON.stringify(operation)}));
 };
 const ok=async operation=>{const response=await send(operation);assert.equal(response.status,200,`Synthetic package ${operation.operation}: ${response.status}`);return (await response.json()).data;};
 const context=await ok({operation:'context',versionId:version,packageId:null});
 const upload={operation:'upload',requestId:randomUUID(),versionId:version,sourceRevision:context.sourceRevision,reason:'Review synthetic original package',standard:'scorm_1_2',sourceSha256:sha,sourceBytes:original.byteLength};
 const stage=await ok(upload);assert.equal(stage.state,'staged');
 assert.equal(sql(`select count(*) from public.learning_packages where course_version_id='${version}'`),'0','staging cannot register bytes');
 const replay=await ok(upload);assert.deepEqual(replay,stage);
 assert.ok(storageCalls.some(call=>call.method==='POST'&&[400,409].includes(call.status)),'actual Storage duplicate response was exercised');
 assert.ok(storageCalls.some(call=>call.method==='GET'&&call.status===200),'duplicate requires exact original-byte observation');
 loseFinish=true;assert.equal((await send({operation:'finish',operationId:stage.operationId})).status,502);
 const receipt=await ok({operation:'finish',operationId:stage.operationId});assert.equal(receipt.status,'pending');
 assert.equal(sql(`select count(*) from public.audit_logs where entity_id='${receipt.packageId}' and action='package_original_registered'`),'1','lost final response never duplicates the audit');
 const packageContext=await ok({operation:'context',versionId:null,packageId:receipt.packageId});
 assert.equal(packageContext.intents.items[0].sourceRevision,upload.sourceRevision);
 assert.equal(packageContext.intents.items[0].result.sourceRevision,receipt.sourceRevision);
 const acceptedStage=await ok({operation:'accept',requestId:randomUUID(),packageId:receipt.packageId,sourceRevision:packageContext.sourceRevision,reason:'Accept reviewed synthetic authored material',entryPoint:'index.html'});
 assert.ok(acceptedStage.runtimeSha256);assert.notEqual(acceptedStage.runtimeSha256,sha);
 await rpc('admin_update_profile',{p_user_id:actor,p_is_active:false});
 assert.equal((await send({operation:'finish',operationId:acceptedStage.operationId})).status,403);
 assert.equal(sql(`select validation_status from public.learning_packages where id='${receipt.packageId}'`),'pending','revocation after byte upload stops acceptance');
 await rpc('admin_update_profile',{p_user_id:actor,p_is_active:true});
 const accepted=await ok({operation:'finish',operationId:acceptedStage.operationId});assert.equal(accepted.status,'accepted');
 const originalPath=sql(`select storage_path from app_private.learning_package_originals where package_id='${receipt.packageId}'`);
 const retained=await native.storage.from('learning-package-originals').download(originalPath);assert.equal(retained.error,null);
 assert.deepEqual(new Uint8Array(await retained.data.arrayBuffer()),original);
 const runtimePath=sql(`select storage_path from public.learning_packages where id='${receipt.packageId}'`);
 assert.equal(runtimePath,`managed/${acceptedStage.operationId}/${accepted.runtimeSha256}.zip`);
 const runtime=await native.storage.from('learning-packages').download(runtimePath);assert.equal(runtime.error,null);
 const bytes=new Uint8Array(await runtime.data.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),accepted.runtimeSha256);
 const files=unzipSync(bytes);assert.deepEqual(files['lesson.txt'],new TextEncoder().encode('Original lesson bytes'));
 assert.match(new TextDecoder().decode(files['index.html']),/carebase\/learning-runtime-bridge.js/);
 authority.session_id=randomUUID();
 const observed=await ok({operation:'status',requestId:upload.requestId});assert.deepEqual(observed.result,receipt);
 assert.equal((await send({operation:'finish',operationId:acceptedStage.operationId})).status,403,'new session observes but never replays another write grant');
 assert.equal(sql(`select count(*) from public.learning_packages where course_version_id='${version}'`),'1');
});
