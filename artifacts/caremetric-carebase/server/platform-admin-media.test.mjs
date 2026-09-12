import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createPlatformMediaRouter, createPlatformMediaHandler } from './platform-admin-media.mjs';
import { parseMediaOperation, projectMediaStage } from '../../../supabase/functions/_shared/courseMediaProtocol.ts';
const id=n=>`23550000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=new Date('2026-09-11T23:50:00Z');
const bytes=new TextEncoder().encode('%PDF-1.7\nSynthetic media transport fixture\n%%EOF');
const sha=createHash('sha256').update(bytes).digest('hex');
const config={enabled:true,commandsEnabled:true,mediaEnabled:true,hubUrl:'https://hub.test',hubKey:'sb_publishable_fixture',
 supabaseUrl:'https://native.test',serviceKey:'fixture-server-only',identities:new Map([[id(1),id(2)]])};
const upload={operation:'media.upload',requestId:id(3),versionId:id(4),blockId:id(8),sourceRevision:'a'.repeat(64),reason:'Synthetic media upload',fileName:'Original.pdf',mimeType:'application/pdf',sourceSha256:sha,sourceBytes:bytes.byteLength};
const path=`global/${id(9)}/${id(6)}/${sha}`;
const asset={id:id(6),contentSha256:sha,mimeType:'application/pdf',byteSize:bytes.byteLength,fileName:'Original.pdf'};
const receipt={operationId:id(5),assetId:id(6),versionId:id(4),blockId:id(8),sourceRevision:'b'.repeat(64),contentSha256:sha,mimeType:'application/pdf',byteSize:bytes.byteLength,fileName:'Original.pdf',attachedAt:now.toISOString()};
function fixture({duplicateStatus=null,duplicateBody=null,badStoredBytes=false,wrongPath=false,wrongRange=false,committed=false,revokeAfterRead=false}={}){
 let approved=upload,active=true,proof=null;const calls=[];let stored=null;
 const native={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:id(2),role:'platform_admin',is_active:active}})})})}),
  auth:{admin:{getUserById:async()=>({data:{user:{id:id(2),is_anonymous:false}}})}},
  rpc:async(name,args)=>{calls.push({name,args});
   if(name==='prepare_delegated_course_media_operation')return {data:committed?{result:receipt}:{result:null,operationId:id(5),assetId:id(6),versionId:id(4),blockId:id(8),contentSha256:sha,mimeType:'application/pdf',byteSize:bytes.byteLength,fileName:'Original.pdf',storagePath:path}};
   if(name==='record_course_media_artifact'){proof=args;return {data:null};}
   if(name==='finish_delegated_course_media_operation'){assert.ok(proof);return {data:receipt};}
   if(name==='get_delegated_course_media_status')return {data:null};
   if(name==='get_delegated_course_media_read'&&!active)return {data:null,error:{code:'42501'}};
   if(name==='get_delegated_course_media_read')return {data:{...asset,storagePath:wrongPath?`global/${id(6)}/${id(9)}/${sha}`:path}};
   throw Error('Unexpected fixture RPC');
  }};
 const fetcher=async(input,init={})=>{
  const url=String(input);calls.push({url,method:init.method});
  if(url.includes('/api/internal/learning/carebase/authorize'))return Response.json({user_id:id(1),role:'platform_admin',method:'sms',session_id:id(7),session_started_at:'2026-09-11T23:00:00Z',assurance_expires_at:'2026-09-12T07:00:00Z',operation:approved});
  if(url.startsWith('https://native.test/storage/v1/object/')){
   assert.equal(init.headers.Authorization,`Bearer ${config.serviceKey}`);assert.equal(init.redirect,'error');
   if(init.method==='POST'){
    assert.equal(init.headers['x-upsert'],'false');assert.equal(init.duplex,'half');stored=new Uint8Array(await new Response(init.body).arrayBuffer());
    if(duplicateStatus)return Response.json(duplicateBody,{status:duplicateStatus});
    return Response.json({Key:'retained'});
   }
   if(revokeAfterRead)active=false;
   const data=badStoredBytes?new Uint8Array(bytes.byteLength):stored??bytes;
   if(init.headers.Range){const [,start,end]=/^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);return new Response(data.slice(Number(start),Number(end)+1),{status:206,headers:{'content-type':'application/pdf','content-length':String(Number(end)-Number(start)+1),'content-range':`bytes ${wrongRange?1:start}-${end}/${bytes.byteLength}`}});}
   return new Response(data,{headers:{'content-type':'application/pdf','content-length':String(data.length)}});
  }
  throw Error('Unexpected network');
 };
 const handler=createPlatformMediaHandler({config,createClient:()=>native,fetcher,now:()=>now});
 const request=(operation=upload,body=bytes)=>operation.operation==='media.upload'
  ?new Request('https://cmcarebase.com/api/learning-admin/media',{method:'POST',headers:{authorization:`Bearer cmh_${'a'.repeat(43)}`,'content-type':'application/pdf','x-caremetric-media-request':Buffer.from(JSON.stringify(operation)).toString('base64url')},body})
  :new Request('https://cmcarebase.com/api/learning-admin/media',{method:'POST',headers:{authorization:`Bearer cmh_${'a'.repeat(43)}`,'content-type':'application/json'},body:JSON.stringify(operation)});
 return {handler,calls,request,stored:()=>stored,approve:op=>{approved=op;},revoke:()=>{active=false;}};
}
test('actual streamed stage verifies stored original; separate fresh ticket attaches',async()=>{
 const f=fixture();const response=await f.handler(f.request());assert.equal(response.status,200);const envelope=await response.json();
 assert.equal(projectMediaStage(envelope.data,upload).state,'staged');assert.deepEqual(f.stored(),bytes);
 assert.ok(f.calls.some(x=>x.name==='record_course_media_artifact'));assert.ok(!f.calls.some(x=>x.name==='finish_delegated_course_media_operation'));
 const op={operation:'media.finish',operationId:id(5)};f.approve(op);assert.equal((await f.handler(f.request(op))).status,200);
 assert.equal(f.calls.filter(x=>x.url?.includes('/authorize')).length,2);
});
test('exact upload delegation cannot be reused to finish',async()=>{
 const f=fixture();assert.equal((await f.handler(f.request({operation:'media.finish',operationId:id(5)}))).status,403);
 assert.ok(!f.calls.some(x=>x.name==='finish_delegated_course_media_operation'));
});
test('actor revocation after verified upload prevents finish',async()=>{
 const f=fixture();assert.equal((await f.handler(f.request())).status,200);f.revoke();const op={operation:'media.finish',operationId:id(5)};f.approve(op);
 assert.equal((await f.handler(f.request(op))).status,403);assert.ok(!f.calls.some(x=>x.name==='finish_delegated_course_media_operation'));
});
test('missing authorization leaves the raw upload unread',async()=>{
 const f=fixture();const request=f.request();request.headers.delete('authorization');assert.equal((await f.handler(request)).status,401);
 assert.equal(request.bodyUsed,false);assert.equal(f.stored(),null);
});
test('browser origin and cookies fail before native identity calls',async()=>{
 for(const [name,value] of [['origin','https://cmcarebase.com'],['origin','null'],['cookie','a=b']]){const f=fixture(),request=f.request();request.headers.set(name,value);assert.equal((await f.handler(request)).status,403);assert.equal(f.calls.length,0);}
});
test('hash mismatch, oversized body and wrong format cannot store media',async()=>{
 for(const [body,status] of [[new Uint8Array(bytes.length),400],[new Uint8Array(bytes.length+1),413]]){const f=fixture();assert.equal((await f.handler(f.request(upload,body))).status,status);assert.equal(f.stored(),null);}
});
test('Storage duplicate must be narrow, bounded evidence and exact observed bytes',async()=>{
 for(const [status,body,expected] of [[409,{},200],[400,{statusCode:'409',code:'ResourceAlreadyExists'},200],[400,{statusCode:'409',error:'Duplicate'},200],
 [400,{statusCode:'409',code:'AccessDenied',error:'Duplicate'},502],[400,{statusCode:'403',code:'Duplicate'},502],[400,{message:'Duplicate'},502],
 [400,{statusCode:'409',error:'Duplicate',padding:'x'.repeat(5000)},502]]){
  const f=fixture({duplicateStatus:status,duplicateBody:body});assert.equal((await f.handler(f.request())).status,expected);
  assert.equal(f.calls.some(x=>x.name==='record_course_media_artifact'),expected===200);
 }
 const corrupt=fixture({duplicateStatus:409,badStoredBytes:true});assert.equal((await corrupt.handler(corrupt.request())).status,400);assert.ok(!corrupt.calls.some(x=>x.name==='record_course_media_artifact'));
});
test('committed stage recovery returns original receipt without uploading again',async()=>{
 const f=fixture({committed:true});const response=await f.handler(f.request());assert.equal(response.status,200);
 assert.equal(projectMediaStage((await response.json()).data,upload).state,'committed');assert.equal(f.stored(),null);
});
test('read binds exact asset path and all byte-range response metadata',async()=>{
 const operation={operation:'media.read',versionId:id(4),blockId:id(8),assetId:id(6),range:{start:0,end:9}};
 const f=fixture();f.approve(operation);const response=await f.handler(f.request(operation));assert.equal(response.status,206);
 assert.equal(response.headers.get('x-caremetric-media-sha256'),sha);assert.equal(response.headers.get('content-range'),`bytes 0-9/${bytes.length}`);
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes.slice(0,10));
 for(const options of [{wrongPath:true},{wrongRange:true}]){const f=fixture(options);f.approve(operation);assert.equal((await f.handler(f.request(operation))).status,502);}
 const beyond={...operation,range:{start:bytes.length,end:null}},g=fixture();g.approve(beyond);assert.equal((await g.handler(g.request(beyond))).status,416);
});
test('disabled media fails closed; status is read-only',async()=>{
 const f=fixture(),op={operation:'media.status',operationId:id(5)};f.approve(op);const response=await f.handler(f.request(op));assert.equal(response.status,200);assert.equal((await response.json()).data,null);assert.equal(f.stored(),null);
 assert.equal((await createPlatformMediaHandler({config:{...config,mediaEnabled:false}})(f.request())).status,503);
});
test('closed requests reject foreign paths, decimal bytes, invalid Unicode names and extra range keys',()=>{
 for(const edit of [{storagePath:'other/path'},{sourceBytes:1.5},{sourceBytes:'128'},{fileName:'\u00a0name.pdf'},{fileName:'x\u0081.pdf'},{fileName:'e\u0301.pdf'},{fileName:'a/b.pdf'}])assert.throws(()=>parseMediaOperation({...upload,...edit}));
 assert.throws(()=>parseMediaOperation({operation:'media.read',versionId:id(4),blockId:id(8),assetId:id(6),range:{start:0,end:1,extra:true}}));
});
test('stage projector rejects malformed/wrong-target successful responses',()=>{
 const good={state:'staged',operationId:id(5),assetId:id(6),versionId:id(4),blockId:id(8),contentSha256:sha,mimeType:'application/pdf',byteSize:bytes.length,fileName:'Original.pdf'};
 for(const changed of [{assetId:'invalid'},{byteSize:1},{fileName:'Other.pdf'},{mimeType:'video/mp4'},{extra:true},{blockId:id(9)}])assert.throws(()=>projectMediaStage({...good,...changed},upload));
 assert.throws(()=>projectMediaStage({state:'committed',result:{...receipt,byteSize:1}},upload));
});

test('native revocation during Storage read prevents disclosure',async()=>{
 const f=fixture({revokeAfterRead:true}),op={operation:'media.read',versionId:id(4),blockId:id(8),assetId:id(6),range:null};f.approve(op);
 const response=await f.handler(f.request(op));assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:{code:'forbidden'}});
});
test('raw anonymous slow JSON never occupies the upload slot; authenticated metadata has its own deadline', {timeout:10_000},async()=>{
 const f=fixture(),route=createPlatformMediaRouter({config,handler:f.handler});
 const server=createServer((req,res)=>{void route(req,res,'/api/learning-admin/media');});server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=server.address().port;
 const slow=headers=>new Promise((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port,path:'/api/learning-admin/media',method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked',...headers}},res=>{
   res.resume();res.on('end',()=>{resolve(res.statusCode);req.destroy();});
  });req.on('error',reject);req.flushHeaders();req.write('{');
 });
 try {
  const start=Date.now();assert.equal(await slow({}),401);assert.ok(Date.now()-start<1500);assert.equal(f.calls.length,0);
  assert.equal(await slow({authorization:'Bearer malformed'}),401);assert.equal(f.calls.length,0);
  const valid={authorization:`Bearer cmh_${'a'.repeat(43)}`};assert.equal(await slow(valid),408);assert.equal(f.calls.length,0);
  const operation={operation:'media.status',operationId:id(5)};f.approve(operation);
  const response=await fetch(`http://127.0.0.1:${port}/api/learning-admin/media`,{method:'POST',headers:{...valid,'content-type':'application/json'},body:JSON.stringify(operation)});
  assert.equal(response.status,200);await response.arrayBuffer();
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
