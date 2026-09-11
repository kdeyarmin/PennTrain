import { Readable } from 'node:stream';
import { unzipSync, zipSync } from 'fflate';
import { AdminError, authorizePlatformAdmin, readPlatformAdminConfig, UUID } from './platform-admin-auth.mjs';
import { createPackageArchiveReader, isSafePackagePath, MAX_PACKAGE_ZIP_BYTES } from '../../../supabase/functions/_shared/learningPackageArchiveCore.ts';
import { boundedPackageBody } from '../../../supabase/functions/_shared/learningPackageHttp.ts';
import { PackageIngestionError, parsePackageOperation, stagePackageOperation, packageRpcError, projectPackageResult } from '../../../supabase/functions/_shared/learningPackageIngestion.ts';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const uuid = value => typeof value === 'string' && UUID.test(value);
export function parsePlatformPackageOperation(value) {
  if (exact(value,['operation','versionId','packageId']) && value.operation==='context'
    && (uuid(value.versionId) && value.packageId===null || value.versionId===null && uuid(value.packageId))) return value;
  if (exact(value,['operation','requestId']) && value.operation==='status' && uuid(value.requestId)) return value;
  if (exact(value,['operation','operationId']) && value.operation==='finish' && uuid(value.operationId)) return value;
  return parsePackageOperation(value);
}
function authorityArgs(context) {
  return {p_actor:context.nativeId,p_hub_user:context.actor.user_id,p_hub_session:context.actor.session_id,
    p_session_started_at:context.actor.session_started_at,p_assurance_expires_at:context.actor.assurance_expires_at,p_authentication_method:context.authenticationMethod};
}
const codec={readArchive:createPackageArchiveReader(unzipSync),zipFiles:files=>zipSync(files,{level:6,mtime:new Date(2000,0,1,0,0,0)})};
async function storageRequest(config, requestSignal, fetcher, bucket, path, bytes) {
  if (!['learning-packages','learning-package-originals'].includes(bucket) || !isSafePackagePath(path)) throw new PackageIngestionError(502,'Invalid package storage reference.');
  const encoded=[bucket,...path.split('/')].map(encodeURIComponent).join('/');
  const response=await fetcher(`${config.supabaseUrl}/storage/v1/object/${bytes?'':'authenticated/'}${encoded}`,{
    method:bytes?'POST':'GET',redirect:'error',signal:AbortSignal.any([requestSignal,AbortSignal.timeout(60_000)]),
    headers:{Authorization:`Bearer ${config.serviceKey}`,apikey:config.serviceKey,...(bytes?{'Content-Type':'application/zip','x-upsert':'false'}:{})},
    ...(bytes?{body:bytes}:{})});
  if (bytes) {
    if (response.body) await response.body.cancel();
    if(response.ok)return 'created';
    // A duplicate is accepted only after a separate GET matches exact bytes.
    if(response.status===400||response.status===409)return 'exists';
    throw new PackageIngestionError(502,'Immutable package bytes could not be stored.');
  }
  if(!response.ok){if(response.body)await response.body.cancel();throw new PackageIngestionError(502,'Original package is unavailable.');}
  return new Blob([await boundedPackageBody(response,MAX_PACKAGE_ZIP_BYTES)]);
}
function checkContext(value,operation) {
  if(!exact(value,['courseId','versionId','sourceRevision','package','intents']) || !uuid(value.courseId)||!uuid(value.versionId)
    || typeof value.sourceRevision!=='string'||!/^[0-9a-f]{64}$/.test(value.sourceRevision)
    || operation.versionId && operation.versionId!==value.versionId || operation.packageId && value.package?.id!==operation.packageId) throw new AdminError(502,'upstream');
  if(value.package!==null && (!exact(value.package,['id','status','contentSha256','entryPoint','standard']) || !uuid(value.package.id)
    || !['pending','validating','accepted','rejected','quarantined'].includes(value.package.status)
    || !/^[0-9a-f]{64}$/.test(value.package.contentSha256) || !(value.package.entryPoint===null || typeof value.package.entryPoint==='string'&&isSafePackagePath(value.package.entryPoint))
    || !['scorm_1_2','scorm_2004_4th','xapi','lti_1_3'].includes(value.package.standard))) throw new AdminError(502,'upstream');
  if(!exact(value.intents,['items','hasMore'])||!Array.isArray(value.intents.items)||value.intents.items.length>20||typeof value.intents.hasMore!=='boolean')throw new AdminError(502,'upstream');
  value.intents.items=value.intents.items.map(row=>{
    if(!exact(row,['requestId','operationId','operation','packageId','versionId','sourceRevision','sourceSha256','runtimeSha256','entryPoint','createdAt','expiresAt','state','canFinishThisSession','result'])
      || !uuid(row.requestId)||!uuid(row.operationId)||!uuid(row.packageId)||row.versionId!==value.versionId
      || !['upload','accept'].includes(row.operation)||!['prepared','staged','committed','expired'].includes(row.state)
      || !/^[0-9a-f]{64}$/.test(row.sourceRevision)||!/^[0-9a-f]{64}$/.test(row.sourceSha256)
      || !(row.runtimeSha256===null||/^[0-9a-f]{64}$/.test(row.runtimeSha256))||!(row.entryPoint===null||typeof row.entryPoint==='string'&&isSafePackagePath(row.entryPoint))
      || !Number.isFinite(Date.parse(row.createdAt))||!Number.isFinite(Date.parse(row.expiresAt))||typeof row.canFinishThisSession!=='boolean'
      || row.canFinishThisSession&&(row.state!=='staged'||row.sourceRevision!==value.sourceRevision)
      || (row.state==='committed')!==(row.result!==null))throw new AdminError(502,'upstream');
    if(row.result!==null){row.result=projectPackageResult(row.result);if(row.result.operationId!==row.operationId||row.result.packageId!==row.packageId||row.result.versionId!==row.versionId)throw new AdminError(502,'upstream');}
    return row;
  });
  return value;
}
export function createPlatformPackageHandler({config,createClient,fetcher=fetch,now=()=>new Date()}={}) {
  return async request=>{
    const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    try {
      if(!config?.enabled||!config.commandsEnabled||!config.packageIngestionEnabled)throw new AdminError(503,'unconfigured');
      if(request.method!=='POST')throw new AdminError(405,'method_not_allowed');
      if(request.headers.has('origin')||request.headers.has('cookie'))throw new AdminError(403,'forbidden');
      let operation;let file=null;
      const rawUpload=request.headers.get('content-type')==='application/zip';
      if(rawUpload){
        const header=request.headers.get('x-caremetric-package-request');
        if(!header||header.length>8192||!/^[A-Za-z0-9_-]+$/.test(header))throw new AdminError(400,'invalid_request');
        const decoded=Buffer.from(header,'base64url');if(decoded.toString('base64url')!==header)throw new AdminError(400,'invalid_request');
        operation=parsePlatformPackageOperation(JSON.parse(decoded.toString('utf8')));
        if(operation.operation!=='upload')throw new AdminError(400,'invalid_request');
      }else{
        if(request.headers.get('content-type')?.split(';',1)[0]!=='application/json'||request.headers.has('x-caremetric-package-request'))throw new AdminError(415,'unsupported_content_type');
        operation=parsePlatformPackageOperation(JSON.parse(new TextDecoder().decode(await boundedPackageBody(request,8192))));
        if(operation.operation==='upload')throw new AdminError(415,'unsupported_content_type');
      }
      // Only the closed metadata is delegated. The original bytes must match its
      // exact size and SHA; authenticate before reading the streamed upload body.
      const authHeaders=new Headers(request.headers);authHeaders.set('content-type','application/json');
      const context=await authorizePlatformAdmin(new Request(request.url,{method:'POST',headers:authHeaders,signal:request.signal}),{
        config,command:true,learning:true,operation,parseOperation:parsePlatformPackageOperation,createClient,fetcher,now});
      const auth=authorityArgs(context);
      const rpc=async(name,args)=>{const response=await context.native.rpc(name,{...auth,...args});packageRpcError(response.error);return response.data;};
      let data;
      if(operation.operation==='context')data=checkContext(await rpc('get_delegated_learning_package_context',{p_version_id:operation.versionId,p_package_id:operation.packageId}),operation);
      else if(operation.operation==='status') {
        data=await rpc('get_delegated_learning_package_operation',{p_request_id:operation.requestId});
        if(data!==null){
          if(!exact(data,['requestId','operation','packageId','versionId','sourceRevision','expiresAt','status','result']) || data.requestId!==operation.requestId
            || !['upload','accept'].includes(data.operation)||!uuid(data.packageId)||!uuid(data.versionId)||!/^[0-9a-f]{64}$/.test(data.sourceRevision)
            || !['pending','expired','committed'].includes(data.status)||!Number.isFinite(Date.parse(data.expiresAt))
            || (data.status==='committed')!==(data.result!==null))throw new AdminError(502,'upstream');
          if(data.result!==null){data.result=projectPackageResult(data.result);if(data.result.packageId!==data.packageId||data.result.versionId!==data.versionId)throw new AdminError(502,'upstream');}
        }
      }else if(operation.operation==='finish'){
        data=projectPackageResult(await rpc('finish_delegated_learning_package_operation',{p_operation_id:operation.operationId}));
        if(data.operationId!==operation.operationId)throw new AdminError(502,'upstream');
      }else{
        if(rawUpload)file=new Blob([await boundedPackageBody(request,MAX_PACKAGE_ZIP_BYTES)]);
        data=await stagePackageOperation(operation,file,{
          codec,prepare:input=>rpc('prepare_delegated_learning_package_operation',{p_request:input}),
          // Hub staging cannot invoke a final write. A fresh, separately delegated
          // finish request is mandatory after the Hub rechecks its current session.
          finish:async()=>{throw new AdminError(403,'forbidden');},
          record:async proof=>{const response=await context.native.rpc('record_learning_package_artifact',proof);packageRpcError(response.error);},
          download:(bucket,path)=>storageRequest(config,request.signal,fetcher,bucket,path),
          upload:(bucket,path,bytes)=>storageRequest(config,request.signal,fetcher,bucket,path,bytes),
        });
      }
      return respond({contractVersion:1,product:'carebase',operation:operation.operation,generatedAt:now().toISOString(),data});
    }catch(error){
      const status=error instanceof AdminError||error instanceof PackageIngestionError?error.status:error instanceof SyntaxError?400:502;
      const code=error instanceof AdminError?error.code:status===401?'unauthenticated':status===403?'forbidden':status===404?'notfound':status===409?'conflict':status===413?'payload_too_large':status===400?'invalid_request':'upstream';
      return respond({error:{code}},status);
    }
  };
}

/** One bounded upload at a time, streamed to authentication before body buffering.
 * ZIP validation itself requires at most 50 MiB compressed / 100 MiB expanded. */
export function createPlatformPackageRouter({config=readPlatformAdminConfig(),handler=createPlatformPackageHandler({config})}={}) {
  let active=false;
  return async(req,res,pathname)=>{
    if(pathname!=='/api/learning-admin/package')return false;
    const fail=(status,code)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',Connection:'close'});res.end(JSON.stringify({error:{code}}));};
    if(active){fail(503,'busy');return true;}
    active=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),120_000);timer.unref?.();
    const abort=()=>{if(!res.writableFinished)controller.abort();};req.once('aborted',abort);res.once('close',abort);
    try {
      if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity'){fail(415,'unsupported_content_encoding');return true;}
      const headers=new Headers();for(const name of ['authorization','content-type','content-length','origin','cookie','x-caremetric-package-request'])if(typeof req.headers[name]==='string')headers.set(name,req.headers[name]);
      const request=new Request('https://cmcarebase.com/api/learning-admin/package',{method:req.method,headers,signal:controller.signal,
        ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const response=await handler(request);const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.byteLength>65536)throw new Error('Response limit');
      res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store',Connection:'close'});res.end(bytes);
    }catch{if(!res.headersSent)fail(controller.signal.aborted?408:502,controller.signal.aborted?'request_timeout':'upstream');}
    finally{clearTimeout(timer);active=false;req.removeListener('aborted',abort);res.removeListener('close',abort);}
    return true;
  };
}
