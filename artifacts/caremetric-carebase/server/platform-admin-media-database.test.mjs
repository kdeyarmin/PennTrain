import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import test from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {createPlatformMediaHandler} from './platform-admin-media.mjs';
import {createNativeCourseMediaHandler} from '../../../supabase/functions/course-media/handler.ts';

test('actual local media Storage/native SQL preserve bytes, receipts, clone source and authorization',{
 skip:process.env.CAREMETRIC_LOCAL_MEDIA_TESTS!=='true',timeout:45_000,
},async()=>{
 const url=new URL(process.env.SUPABASE_URL??'');assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY,anon=process.env.SUPABASE_ANON_KEY;
 const native=createClient(url.origin,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const sql=input=>execFileSync('docker',['exec','-i','supabase_db_xsqobvvreaovwibxwyvv','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 const rpc=async(name,args)=>{const r=await native.rpc(name,args);assert.equal(r.error,null,`Synthetic ${name}: ${r.error?.code??''}`);return r.data;};
 const email=`media-${randomUUID()}@fixture.test`,password=randomUUID()+'Aa1!';
 const created=await native.auth.admin.createUser({email,email_confirm:true,password});assert.equal(created.error,null);const actor=created.data.user.id;
 await rpc('admin_update_profile',{p_user_id:actor,p_role:'platform_admin',p_is_active:true});
 const course=randomUUID(),version=randomUUID(),block=randomUUID(),hubUser=randomUUID(),hubSession=randomUUID();
 sql(`begin;insert into public.courses(id,organization_id,title,status,created_by) values('${course}',null,'Media HTTP fixture','draft','${actor}');
 insert into public.course_versions(id,course_id,organization_id,version_number,title,status) values('${version}','${course}',null,1,'Media HTTP draft','draft');
 insert into public.course_blocks(id,course_version_id,organization_id,block_type,sort_order,title) values('${block}','${version}',null,'pdf',0,'PDF lesson');commit;`);
 const original=new TextEncoder().encode('%PDF-1.7\nSynthetic immutable source fixture\n%%EOF');const sha=createHash('sha256').update(original).digest('hex');
 const tickets=new Map(),storageCalls=[];let loseFinish=false;
 const started=new Date(Date.now()-60_000),authority={user_id:hubUser,role:'platform_admin',method:'sms',session_id:hubSession,session_started_at:started.toISOString(),assurance_expires_at:new Date(started.getTime()+480*60_000).toISOString()};
 const handler=createPlatformMediaHandler({config:{enabled:true,commandsEnabled:true,mediaEnabled:true,supabaseUrl:url.origin,serviceKey,identities:new Map([[hubUser,actor]])},createClient,
  fetcher:async(input,init)=>{
   const target=new URL(input instanceof Request?input.url:input);
   if(target.href==='https://support-hub-web-production.up.railway.app/api/internal/learning/carebase/authorize'){
    const ticket=new Headers(init.headers).get('authorization'),operation=tickets.get(ticket);tickets.delete(ticket);
    return operation?Response.json({...authority,operation}):Response.json({},{status:401});
   }
   assert.equal(target.origin,url.origin,'Synthetic fixture cannot contact external services');const response=await fetch(input,init);
   if(target.pathname.startsWith('/storage/'))storageCalls.push({method:init?.method??'GET',status:response.status});
   if(loseFinish&&target.pathname==='/rest/v1/rpc/finish_delegated_course_media_operation'){loseFinish=false;await response.arrayBuffer();throw new Error('Synthetic committed response lost');}
   return response;
  }});
 const send=operation=>{
  const ticket=`Bearer cmh_${randomBytes(32).toString('base64url')}`;tickets.set(ticket,operation);
  return handler(new Request('https://cmcarebase.com/api/learning-admin/media',{method:'POST',headers:{authorization:ticket,
   ...(operation.operation==='media.upload'?{'content-type':'application/pdf','x-caremetric-media-request':Buffer.from(JSON.stringify(operation)).toString('base64url')}:{'content-type':'application/json'})},
   body:operation.operation==='media.upload'?original:JSON.stringify(operation)}));
 };
 const ok=async op=>{const response=await send(op);assert.equal(response.status,200,`Synthetic media ${op.operation}: ${response.status}`);return (await response.json()).data;};
 const context=await ok({operation:'media.context',versionId:version,blockId:block});
 const upload={operation:'media.upload',requestId:randomUUID(),versionId:version,blockId:block,sourceRevision:context.sourceRevision,reason:'Review original synthetic PDF',fileName:'Original.pdf',mimeType:'application/pdf',sourceSha256:sha,sourceBytes:original.byteLength};
 const stage=await ok(upload);assert.equal(stage.state,'staged');assert.equal(sql(`select coalesce(media_asset_id::text,'none') from public.course_blocks where id='${block}'`),'none');
 assert.deepEqual(await ok(upload),stage);assert.ok(storageCalls.some(x=>x.method==='POST'&&[400,409].includes(x.status)),'actual Storage duplicate observed');
 const direct=await native.from('course_blocks').update({media_asset_id:stage.assetId}).eq('id',block);assert.equal(direct.error?.code,'42501','raw service column cannot bypass finish');
 await rpc('admin_update_profile',{p_user_id:actor,p_is_active:false});assert.equal((await send({operation:'media.finish',operationId:stage.operationId})).status,403);
 await rpc('admin_update_profile',{p_user_id:actor,p_is_active:true});loseFinish=true;assert.equal((await send({operation:'media.finish',operationId:stage.operationId})).status,502);
 const receipt=await ok({operation:'media.finish',operationId:stage.operationId});assert.equal(receipt.assetId,stage.assetId);
 assert.equal(sql(`select count(*) from public.audit_logs where entity_id='${block}' and action='course_media_attached'`),'1');
 assert.notEqual(receipt.sourceRevision,upload.sourceRevision);
 const saved=await ok({operation:'media.context',versionId:version,blockId:block});assert.equal(saved.block.mediaAsset.id,receipt.assetId);assert.equal(saved.intents.items[0].sourceRevision,upload.sourceRevision);
 const response=await send({operation:'media.read',versionId:version,blockId:block,assetId:receipt.assetId,range:{start:0,end:9}});assert.equal(response.status,206);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),original.slice(0,10));
 const storagePath=sql(`select storage_path from app_private.course_media_assets where id='${receipt.assetId}'`);
 const retained=await native.storage.from('course-media').download(storagePath);assert.equal(retained.error,null);assert.deepEqual(new Uint8Array(await retained.data.arrayBuffer()),original);
 // A writer holds the version while finish waits. Once the writer commits,
 // finalization must compare the new source rather than attach a stale upload.
 const pending=await ok({...upload,requestId:randomUUID(),sourceRevision:saved.sourceRevision});
 const writer=spawn('docker',['exec','-i','supabase_db_xsqobvvreaovwibxwyvv','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt'],{stdio:['pipe','pipe','pipe']});
 let output='';const finished=new Promise((resolve,reject)=>{writer.once('error',reject);writer.once('exit',code=>code===0?resolve():reject(new Error('Synthetic source writer failed')));});
 const held=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Synthetic source lock not reached')),5000);
  writer.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('holding-source-lock')){clearTimeout(timer);resolve();}});
  writer.once('error',error=>{clearTimeout(timer);reject(error);});});
 writer.stdin.end(`begin;update public.course_versions set title='Concurrent reviewed source' where id='${version}';select 'holding-source-lock';select pg_sleep(0.8);commit;`);
 await held;assert.equal((await send({operation:'media.finish',operationId:pending.operationId})).status,409);await finished;
 assert.equal(sql(`select media_asset_id from public.course_blocks where id='${block}'`),receipt.assetId,'waiting finish preserves original media after source drift');
 const replays=await Promise.all([ok({operation:'media.finish',operationId:stage.operationId}),ok({operation:'media.finish',operationId:stage.operationId})]);
 assert.deepEqual(replays,[receipt,receipt]);assert.equal(sql(`select count(*) from public.audit_logs where entity_id='${block}' and action='course_media_attached'`),'1');
 const clone=sql(`select (app_private.clone_course_version_core('${actor}','${version}','${course}',null,2,'Cloned media draft')).id`);
 assert.equal(sql(`select media_asset_id from public.course_blocks where course_version_id='${clone}'`),receipt.assetId,'clone shares immutable course asset');
 assert.equal(sql(`select count(*) from public.course_assignments where course_version_id='${clone}'`),'0','clone copies no learner history');
 assert.equal(sql(`select app_private.publish_course_version_core('${version}')`),version,'shared native publisher accepts verified PDF');
 authority.session_id=randomUUID();const observed=await ok({operation:'media.status',operationId:stage.operationId});assert.deepEqual(observed.result,receipt);
 assert.equal((await send({operation:'media.finish',operationId:stage.operationId})).status,403,'cross-session receipt recovery is read-only');
 // Exercise the native browser handler with a real Auth session, then revoke it.
 const login=createClient(url.origin,anon,{auth:{persistSession:false,autoRefreshToken:false}});const signedIn=await login.auth.signInWithPassword({email,password});assert.equal(signedIn.error,null);
 const nativeHandler=createNativeCourseMediaHandler({createClient,getEnv:key=>({SUPABASE_URL:url.origin,SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:serviceKey})[key]});
 const read=()=>nativeHandler(new Request(url.origin+'/functions/v1/course-media',{method:'POST',headers:{authorization:'Bearer '+signedIn.data.session.access_token,'content-type':'application/json'},body:JSON.stringify({operation:'media.read',versionId:version,blockId:block,assetId:receipt.assetId,range:null})}));
 const linkResponse=await read();assert.equal(linkResponse.status,200);const link=(await linkResponse.json()).data;assert.equal(new URL(link.url).origin,url.origin);
 const download=await fetch(link.url);assert.equal(download.status,200);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),original);
 await rpc('admin_update_profile',{p_user_id:actor,p_is_active:false});assert.equal((await read()).status,403);
});
