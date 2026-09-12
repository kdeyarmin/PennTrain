import {timingSafeEqual} from 'node:crypto';
import {createClient as createSupabaseClient} from '@supabase/supabase-js';
import {AdminError,boundedFetch,readPlatformAdminConfig,UUID} from './platform-admin-auth.mjs';
import {createProviderRouter} from './provider-router.mjs';
const DOMAIN='course.distribution.status.v1';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const SHA=/^[0-9a-f]{64}$/;
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const uuid=value=>typeof value==='string'&&UUID.test(value);
const state=value=>['draft','published','archived'].includes(value);
export function parseDistributionStatus(value){
  if(!exact(value,['domain','operation','courseIds'])||value.domain!==DOMAIN||value.operation!=='status'
    ||!Array.isArray(value.courseIds)||value.courseIds.length<1||value.courseIds.length>10
    ||!value.courseIds.every(uuid)||new Set(value.courseIds.map(id=>id.toLowerCase())).size!==value.courseIds.length)throw new AdminError(400,'invalid_request');
  return {...value,courseIds:value.courseIds.map(id=>id.toLowerCase())};
}
export function projectDistributionStatus(value,operation){
  const check=valid=>{if(!valid)throw new AdminError(502,'upstream');};
  check(exact(value,['items'])&&Array.isArray(value.items)&&value.items.length===operation.courseIds.length);
  const remaining=new Set(operation.courseIds);
  for(const item of value.items){
    check(exact(item,['courseId','publicationState','currentVersionId','currentVersionState','sourceRevision'])
      &&uuid(item.courseId)&&remaining.delete(item.courseId.toLowerCase()));
    check(state(item.publicationState)||item.publicationState==='missing');
    check((item.currentVersionId===null||uuid(item.currentVersionId))&&(item.currentVersionState===null||state(item.currentVersionState))
      &&(item.currentVersionId===null)===(item.currentVersionState===null));
    check(item.publicationState!=='missing'||item.currentVersionId===null);
    check(item.publicationState==='published'&&item.currentVersionState==='published'
      ?typeof item.sourceRevision==='string'&&SHA.test(item.sourceRevision):item.sourceRevision===null);
  }
  check(Buffer.byteLength(JSON.stringify(value))<=16000);return value;
}
export function createDistributionStatusHandler({config,token,createClient=createSupabaseClient,fetcher=fetch,now=()=>new Date()}){
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return async request=>{
    try{
      if(!config.enabled||!TOKEN.test(token??''))throw new AdminError(503,'unconfigured');
      if(request.method!=='POST')throw new AdminError(405,'method_not_allowed');
      if(request.headers.has('origin')||request.headers.has('cookie'))throw new AdminError(403,'forbidden');
      const supplied=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      if(!supplied||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))throw new AdminError(401,'unauthenticated');
      if(request.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')throw new AdminError(415,'unsupported_content_type');
      let operation;try{const raw=await request.text();if(Buffer.byteLength(raw)>2048)throw Error();operation=parseDistributionStatus(JSON.parse(raw));}catch{throw new AdminError(400,'invalid_request');}
      request.signal.throwIfAborted();
      const native=createClient(config.supabaseUrl,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
        global:{fetch:(input,init)=>boundedFetch(fetcher,request.signal,input,init,16384)}});
      const result=await native.rpc('get_learning_distribution_status',{p_course_ids:operation.courseIds});
      if(result.error)throw new AdminError(503,'upstream');
      return json({contractVersion:1,product:'carebase',domain:DOMAIN,operation:'status',generatedAt:now().toISOString(),data:projectDistributionStatus(result.data,operation)});
    }catch(error){return json({error:{code:error instanceof AdminError?error.code:'upstream'}},error instanceof AdminError?error.status:503);}
  };
}
export function createDistributionStatusRouter(options={}){
  const getEnv=options.getEnv??(name=>process.env[name]);
  const config=options.config??readPlatformAdminConfig(getEnv);
  const token=getEnv('CAREBASE_DISTRIBUTION_OBSERVER_TOKEN');
  return createProviderRouter({handlers:new Map([['distribution-status',createDistributionStatusHandler({...options,config,token})]]),
    enabled:config.enabled&&TOKEN.test(token??''),prefix:'/api/internal/learning/',unavailableCode:'unconfigured',
    routes:new Map([['distribution-status',{bytes:2048,responseBytes:16384,browser:false}]]),
    forwardedHeaders:['authorization','content-type','origin','cookie'],handlerTimeoutMs:12000,maxConcurrent:2,maxPendingBodies:4});
}
