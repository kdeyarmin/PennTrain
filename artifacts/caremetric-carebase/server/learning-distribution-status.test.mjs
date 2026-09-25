import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {createDistributionStatusHandler,createDistributionStatusRouter,parseDistributionStatus,projectDistributionStatus} from './learning-distribution-status.mjs';
const id=n=>`dd000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const token='a'.repeat(43);
const operation={domain:'course.distribution.status.v1',operation:'status',courseIds:[id(1),id(2)]};
const data={items:[{courseId:id(1),publicationState:'published',currentVersionId:id(3),currentVersionState:'published',sourceRevision:'b'.repeat(64)},
  {courseId:id(2),publicationState:'missing',currentVersionId:null,currentVersionState:null,sourceRevision:null}]};
const config={enabled:true,supabaseUrl:'https://native.example.test',serviceKey:'sb_secret_fixture'};
const request=(body=operation,headers={})=>new Request('https://cmcarebase.com/api/internal/learning/distribution-status',{method:'POST',
  headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('observer admits only bounded unique course IDs and its own closed domain',()=>{
  assert.deepEqual(parseDistributionStatus(operation),operation);
  for(const bad of [{...operation,courseIds:[]},{...operation,courseIds:Array(11).fill(id(1))},{...operation,courseIds:[id(1),id(1).toUpperCase()]},
    {...operation,domain:'course.distribution.v1'},{...operation,operation:'publish'},{...operation,actorId:id(3)}])assert.throws(()=>parseDistributionStatus(bad));
});
test('observer projects exact source cohort, current hash and tombstones without content or PII',()=>{
  assert.deepEqual(projectDistributionStatus(data,operation),data);
  for(const items of [[data.items[0]], [data.items[0],data.items[0]], [{...data.items[0],courseId:id(9)},data.items[1]],
    [{...data.items[0],payload:'private'},data.items[1]],[{...data.items[0],sourceRevision:null},data.items[1]],
    [data.items[0],{...data.items[1],currentVersionId:id(3),currentVersionState:'draft'}],
    [{...data.items[0],publicationState:'archived'},data.items[1]],
    [{...data.items[0],currentVersionId:null},data.items[1]]])assert.throws(()=>projectDistributionStatus({items},operation));
});
test('real Supabase HTTP transport sends service authority only to the fixed status RPC',async()=>{
  let calls=0;
  const handler=createDistributionStatusHandler({config,token,fetcher:async(input,init)=>{
    calls++;assert.equal(String(input),'https://native.example.test/rest/v1/rpc/get_learning_distribution_status');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer sb_secret_fixture');assert.equal(init.redirect,'error');
    assert.ok(init.signal instanceof AbortSignal);assert.deepEqual(JSON.parse(init.body),{p_course_ids:operation.courseIds});
    assert.equal(new Headers(init.headers).has('cookie'),false);return Response.json(data);
  }});
  const response=await handler(request());assert.equal(response.status,200);assert.deepEqual((await response.json()).data,data);assert.equal(calls,1);
});
test('human credentials, browser headers and wrong machine tokens stop before any native connection',async()=>{
  const handler=createDistributionStatusHandler({config,token,createClient:()=>{throw Error('Unexpected connection');}});
  for(const headers of [{authorization:'Bearer cmh_'+token},{authorization:'Bearer a.b.c'},{authorization:'Bearer '+'b'.repeat(43)},
    {authorization:''},{origin:'https://cmcarebase.com'},{cookie:'owner=session'}])assert.ok([401,403].includes((await handler(request(operation,headers))).status));
  assert.equal((await createDistributionStatusHandler({config,token:'short'})(request())).status,503);
});
test('upstream failures and oversized streams disclose no native error or content',async()=>{
  for(const fetcher of [async()=>Response.json({code:'42501',message:'sensitive native detail'}, {status:403}),
    async()=>new Response('x'.repeat(17000)),async()=>{throw Error('private service credential');}]){
    const response=await createDistributionStatusHandler({config,token,fetcher})(request());assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:{code:'upstream'}});
  }
});
test('actual Node route rejects cookies and limits bytes, verbs and route names',async t=>{
  const router=createDistributionStatusRouter({config,getEnv:key=>key==='CAREBASE_DISTRIBUTION_OBSERVER_TOKEN'?token:undefined,
    createClient:()=>{throw Error('Unexpected native connection');}});
  const server=createServer(async(req,res)=>{if(!await router(req,res,new URL(req.url,'https://cmcarebase.com').pathname)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${server.address().port}/api/internal/learning/distribution-status`;
  const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,cookie:'a=b'},body:JSON.stringify(operation)})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:'x'.repeat(2049)})).status,413);
  assert.equal((await fetch(url,{method:'GET',headers})).status,405);
  assert.equal((await fetch(url+'-other',{method:'POST',headers,body:'{}'})).status,404);
});
