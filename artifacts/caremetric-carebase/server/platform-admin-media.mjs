import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AdminError, authorizePlatformAdmin, readPlatformAdminConfig } from './platform-admin-auth.mjs';
import { MediaError, MEDIA_METADATA_LIMIT, mediaExact, projectMediaAsset, parseMediaOperation, projectMediaContext, projectMediaIntent, projectMediaReceipt } from '../../../supabase/functions/_shared/courseMediaProtocol.ts';
import { parseMediaHttpRequest, mediaStorageRequest } from '../../../supabase/functions/_shared/courseMediaHttp.ts';
import { stageCourseMedia, mediaRpcError } from '../../../supabase/functions/_shared/courseMediaIngestion.ts';

function bearerReady(value) {
  return typeof value==='string' && value.length<=8192 && /^Bearer (?:cmh_[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(value);
}

export function createPlatformMediaHandler({config,createClient,fetcher=fetch,now=()=>new Date()}={}) {
  return async request=>{
    const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
    try {
      if(!config?.enabled||!config.commandsEnabled||!config.mediaEnabled)throw new AdminError(503,'unconfigured');
      if(request.method!=='POST')throw new AdminError(405,'method_not_allowed');
      if(!bearerReady(request.headers.get('authorization')))throw new AdminError(401,'unauthenticated');
      if(request.headers.has('origin')||request.headers.has('cookie'))throw new AdminError(403,'forbidden');
      const operation=await parseMediaHttpRequest(request);
      const headers=new Headers(request.headers);headers.set('content-type','application/json');
      const context=await authorizePlatformAdmin(new Request(request.url,{method:'POST',headers,signal:request.signal}),{
        config,command:true,learning:true,operation,parseOperation:parseMediaOperation,createClient,fetcher,now});
      const auth={p_actor:context.nativeId,p_hub_user:context.actor.user_id,p_hub_session:context.actor.session_id,
        p_session_started_at:context.actor.session_started_at,p_assurance_expires_at:context.actor.assurance_expires_at,p_authentication_method:context.authenticationMethod};
      const rpc=async(name,args)=>{const result=await context.native.rpc(name,{...auth,...args});mediaRpcError(result.error);return result.data;};
      let data;
      if(operation.operation==='media.context')data=projectMediaContext(await rpc('get_delegated_course_media_context',{p_version_id:operation.versionId,p_block_id:operation.blockId}),operation);
      else if(operation.operation==='media.status'){
        const value=await rpc('get_delegated_course_media_status',{p_operation_id:operation.operationId});
        data=value===null?null:projectMediaIntent(value);if(data&&data.operationId!==operation.operationId)throw new AdminError(502,'upstream');
      }else if(operation.operation==='media.finish'){
        data=projectMediaReceipt(await rpc('finish_delegated_course_media_operation',{p_operation_id:operation.operationId}));
        if(data.operationId!==operation.operationId)throw new AdminError(502,'upstream');
      }else if(operation.operation==='media.upload'){
        data=await stageCourseMedia(operation,request.body,{
          prepare:input=>rpc('prepare_delegated_course_media_operation',{p_request:input}),
          record:async proof=>{const result=await context.native.rpc('record_course_media_artifact',proof);mediaRpcError(result.error);},
          storage:(path,input)=>mediaStorageRequest(config,request.signal,path,input,fetcher),
        },request.signal);
      }else{
        const reference=await rpc('get_delegated_course_media_read',{p_version_id:operation.versionId,p_block_id:operation.blockId,p_asset_id:operation.assetId});
        if(!mediaExact(reference,['id','contentSha256','mimeType','byteSize','fileName','storagePath'])||reference.id!==operation.assetId
          || typeof reference.storagePath!=='string'||reference.storagePath.split('/')[2]!==operation.assetId || !reference.storagePath.endsWith('/'+reference.contentSha256)
          || !/^(?:global|[0-9a-f-]{36})\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(reference.storagePath))throw new AdminError(502,'upstream');
        const {storagePath,...projection}=reference;const asset=projectMediaAsset(projection);
        const start=operation.range?.start??0,end=operation.range?.end??asset.byteSize-1;
        if(start>=asset.byteSize||end>=asset.byteSize)throw new MediaError(416,'Requested range exceeds the media.');
        const size=end-start+1;
        const response=await fetcher(`${config.supabaseUrl}/storage/v1/object/authenticated/course-media/${storagePath}`,{method:'GET',redirect:'error',
          signal:AbortSignal.any([request.signal,AbortSignal.timeout(90_000)]),headers:{Authorization:`Bearer ${config.serviceKey}`,apikey:config.serviceKey,
            ...(operation.range?{Range:`bytes=${start}-${end}`}:{})}});
        if(response.status!==(operation.range?206:200)||response.headers.get('content-type')?.split(';',1)[0]!==asset.mimeType
          || response.headers.get('content-length')!==String(size)||operation.range&&response.headers.get('content-range')!==`bytes ${start}-${end}/${asset.byteSize}`){
          await response.body?.cancel();throw new AdminError(502,'upstream');}
        // Recheck native account/session and exact attachment after Storage I/O,
        // before disclosing any bytes. Hub rechecks its session after transport.
        try {
          const current=await rpc('get_delegated_course_media_read',{p_version_id:operation.versionId,p_block_id:operation.blockId,p_asset_id:operation.assetId});
          if(!mediaExact(current,Object.keys(reference))||Object.keys(reference).some(key=>current[key]!==reference[key]))throw new AdminError(409,'conflict');
        } catch(error) {await response.body?.cancel();throw error;}
        let count=0;
        const bounded=response.body?.pipeThrough(new TransformStream({transform(chunk,controller){count+=chunk.byteLength;if(count>size)throw new Error('Media exceeds response limit');controller.enqueue(chunk);},flush(){if(count!==size)throw new Error('Incomplete media');}}));
        if(!bounded)throw new AdminError(502,'upstream');
        return new Response(bounded,{status:response.status,headers:{'content-type':asset.mimeType,'content-length':String(size),
          'cache-control':'private, no-store','x-content-type-options':'nosniff','x-caremetric-media-asset':asset.id,
          'x-caremetric-media-sha256':asset.contentSha256,'x-caremetric-media-size':String(asset.byteSize),
          ...(operation.range?{'content-range':`bytes ${start}-${end}/${asset.byteSize}`}:{})}});
      }
      return json({contractVersion:1,product:'carebase',operation:operation.operation,generatedAt:now().toISOString(),data});
    }catch(error){
      const status=error instanceof AdminError||error instanceof MediaError?error.status:error instanceof SyntaxError?400:502;
      const code=error instanceof AdminError?error.code:status===401?'unauthenticated':status===403?'forbidden':status===404?'notfound':status===409?'conflict':status===408?'request_timeout':status===413?'payload_too_large':status===400?'invalid_request':status===416?'invalid_range':'upstream';
      return json({error:{code}},status);
    }
  };
}

export function createPlatformMediaRouter({config=readPlatformAdminConfig(),handler=createPlatformMediaHandler({config})}={}) {
  let active=false;
  return async(req,res,pathname)=>{
    if(pathname!=='/api/learning-admin/media')return false;
    const fail=(status,code)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',Connection:'close'});res.end(JSON.stringify({error:{code}}));};
    if(req.method!=='POST'){fail(405,'method_not_allowed');return true;}
    if(!bearerReady(req.headers.authorization)){fail(401,'unauthenticated');return true;}
    if(req.headers.origin!==undefined||req.headers.cookie!==undefined){fail(403,'forbidden');return true;}
    if(active){fail(503,'busy');return true;}active=true;
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),120_000);timer.unref?.();
    const abort=()=>{if(!res.writableFinished)controller.abort();};req.once('aborted',abort);res.once('close',abort);
    try {
      const headers=new Headers();for(const name of ['authorization','content-type','content-length','content-encoding','origin','cookie','x-caremetric-media-request'])if(typeof req.headers[name]==='string')headers.set(name,req.headers[name]);
      const request=new Request('https://cmcarebase.com/api/learning-admin/media',{method:req.method,headers,signal:controller.signal,
        ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const response=await handler(request);
      if(response.headers.get('content-type')==='application/json'){
        const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>MEDIA_METADATA_LIMIT)throw new Error('Response limit');
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);
      }else{res.writeHead(response.status,Object.fromEntries(response.headers));await pipeline(Readable.fromWeb(response.body),res,{signal:controller.signal});}
    }catch{if(!res.headersSent)fail(controller.signal.aborted?408:502,controller.signal.aborted?'request_timeout':'upstream');else res.destroy();}
    finally{clearTimeout(timer);active=false;req.removeListener('aborted',abort);res.removeListener('close',abort);}
    return true;
  };
}
