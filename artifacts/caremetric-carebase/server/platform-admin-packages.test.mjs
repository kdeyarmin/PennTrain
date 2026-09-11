import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { createPlatformPackageHandler,parsePlatformPackageOperation } from './platform-admin-packages.mjs';
const id=n=>`23000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=new Date('2026-09-11T22:00:00Z');
const bytes=zipSync({'index.html':new TextEncoder().encode('<html><body>Package fixture</body></html>')});
const sha=createHash('sha256').update(bytes).digest('hex');
const config={enabled:true,commandsEnabled:true,packageIngestionEnabled:true,hubUrl:'https://hub.test',hubKey:'sb_publishable_fixture',
 supabaseUrl:'https://native.test',serviceKey:'fixture-server-only',identities:new Map([[id(1),id(2)]])};
const upload={operation:'upload',requestId:id(3),versionId:id(4),sourceRevision:'a'.repeat(64),reason:'Synthetic package upload',standard:'scorm_1_2',sourceSha256:sha,sourceBytes:bytes.byteLength};
function fixture(){
 let approved=upload,active=true,proof=null;const calls=[];const stored=new Map();
 const receipt={operationId:id(5),packageId:id(6),versionId:id(4),sourceRevision:'b'.repeat(64),status:'pending',sourceSha256:sha,runtimeSha256:null,entryPoint:null};
 const native={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:id(2),role:'platform_admin',is_active:active}})})})}),
  auth:{admin:{getUserById:async()=>({data:{user:{id:id(2),is_anonymous:false}}})}},
  rpc:async(name,args)=>{calls.push({name,args});
   if(name==='prepare_delegated_learning_package_operation')return {data:{result:null,operation:'upload',operationId:id(5),packageId:id(6),versionId:id(4),source:{bucket:'learning-package-originals',path:'global/course/package/source.zip',sha256:sha,bytes:bytes.byteLength},originalPath:'global/course/package/source.zip',runtimePrefix:`managed/${id(5)}/`}};
   if(name==='record_learning_package_artifact'){proof=args;return {data:null};}
   if(name==='finish_delegated_learning_package_operation'){assert.ok(proof);return {data:receipt};}
   if(name==='get_delegated_learning_package_operation')return {data:null};
   throw Error('Unexpected fixture RPC');
  }};
 const fetcher=async(input,init={})=>{
  const url=String(input);calls.push({url,method:init.method});
  if(url.includes('/api/internal/learning/carebase/authorize'))return Response.json({user_id:id(1),role:'platform_admin',method:'sms',session_id:id(7),session_started_at:'2026-09-11T21:00:00Z',assurance_expires_at:'2026-09-12T05:00:00Z',operation:approved});
  if(url.startsWith('https://native.test/storage/v1/object/')){
   assert.equal(init.headers.Authorization,`Bearer ${config.serviceKey}`);assert.equal(init.redirect,'error');
   if(init.method==='POST'){assert.equal(init.headers['x-upsert'],'false');stored.set(url,init.body);return Response.json({Key:'retained'});}
   return new Response(stored.get(url.replace('/authenticated/','/'))??null);
  }
  throw Error('Unexpected network');
 };
 const handler=createPlatformPackageHandler({config,createClient:()=>native,fetcher,now:()=>now});
 const request=(operation=upload,body=bytes)=>operation.operation==='upload'
  ?new Request('https://cmcarebase.com/api/learning-admin/package',{method:'POST',headers:{authorization:`Bearer cmh_${'a'.repeat(43)}`,'content-type':'application/zip','x-caremetric-package-request':Buffer.from(JSON.stringify(operation)).toString('base64url')},body})
  :new Request('https://cmcarebase.com/api/learning-admin/package',{method:'POST',headers:{authorization:`Bearer cmh_${'a'.repeat(43)}`,'content-type':'application/json'},body:JSON.stringify(operation)});
 return {handler,calls,stored,request,approve:op=>{approved=op;},revoke:()=>{active=false;}};
}
test('raw upload stages immutable original and cannot finalize on its first ticket',async()=>{
 const f=fixture();const response=await f.handler(f.request());assert.equal(response.status,200);
 const envelope=await response.json();assert.equal(envelope.data.state,'staged');assert.equal(envelope.data.sourceSha256,sha);
 assert.ok(f.calls.some(x=>x.name==='record_learning_package_artifact'));assert.ok(!f.calls.some(x=>x.name==='finish_delegated_learning_package_operation'));
 assert.equal(f.stored.size,1);assert.deepEqual([...f.stored.values()][0],bytes);
 const finish={operation:'finish',operationId:id(5)};f.approve(finish);
 assert.equal((await f.handler(f.request(finish))).status,200);
 assert.equal(f.calls.filter(x=>x.url?.includes('/authorize')).length,2);
});
test('an upload ticket cannot authorize final commit',async()=>{
 const f=fixture();const response=await f.handler(f.request({operation:'finish',operationId:id(5)}));assert.equal(response.status,403);
 assert.ok(!f.calls.some(x=>x.name==='finish_delegated_learning_package_operation'));
});
test('native actor revocation between staging and new finish stops commit',async()=>{
 const f=fixture();assert.equal((await f.handler(f.request())).status,200);f.revoke();const finish={operation:'finish',operationId:id(5)};f.approve(finish);
 assert.equal((await f.handler(f.request(finish))).status,403);assert.ok(!f.calls.some(x=>x.name==='finish_delegated_learning_package_operation'));
});
test('missing authorization fails before streaming upload is consumed',async()=>{
 const f=fixture();let pulls=0;const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array([1]));controller.close();}});
 const request=new Request('https://cmcarebase.com/api/learning-admin/package',{method:'POST',headers:{'content-type':'application/zip','x-caremetric-package-request':Buffer.from(JSON.stringify(upload)).toString('base64url')},body:stream,duplex:'half'});
 const response=await f.handler(request);assert.equal(response.status,401);assert.equal(request.bodyUsed,false);assert.ok(pulls<=1);assert.equal(f.stored.size,0);
});
test('declared hash and byte mismatch cannot write an original',async()=>{
 const f=fixture();const response=await f.handler(f.request(upload,new Uint8Array(bytes.byteLength)));assert.equal(response.status,409);assert.equal(f.stored.size,0);
});
test('browser origin, cookies and external path metadata are rejected',async()=>{
 for(const header of ['origin','cookie']){const f=fixture();const r=f.request();r.headers.set(header,header==='origin'?'https://cmcarebase.com':'host=present');assert.equal((await f.handler(r)).status,403);assert.equal(f.calls.length,0);}
 assert.throws(()=>parsePlatformPackageOperation({...upload,storagePath:'foreign/file.zip'}));
 assert.throws(()=>parsePlatformPackageOperation({operation:'context',versionId:id(4),packageId:id(6)}));
});
test('status is read-only and a disabled deployment cannot ingest',async()=>{
 const f=fixture();const op={operation:'status',requestId:id(3)};f.approve(op);const response=await f.handler(f.request(op));assert.equal(response.status,200);assert.equal((await response.json()).data,null);assert.equal(f.stored.size,0);
 const off=createPlatformPackageHandler({config:{...config,packageIngestionEnabled:false}});assert.equal((await off(f.request())).status,503);
});
