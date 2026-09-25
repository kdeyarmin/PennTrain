import { strict as assert } from "node:assert";
import { createNativeCourseMediaHandler } from "./handler.ts";
const id=(n:number)=>`23550000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const asset={id:id(1),contentSha256:"a".repeat(64),mimeType:"application/pdf",byteSize:40,fileName:"Original.pdf"};
function fixture(options:{revoked?:boolean;wrongPath?:boolean;revokeAfterSign?:boolean}={}){
  let signed=0,reads=0;const calls:string[]=[];
  const client={auth:{getUser:async()=>({data:{user:options.revoked?null:{id:id(2)}},error:null})},
    rpc:async(name:string)=>{calls.push(name);if(name==="get_native_course_media_status")return {data:null,error:null};
      if(name==="get_native_course_media_read"){reads++;return options.revokeAfterSign&&reads>1?{data:null,error:{code:"42501"}}:
       {data:{...asset,storagePath:`global/${id(3)}/${options.wrongPath?id(4):id(1)}/${asset.contentSha256}`},error:null};}
      throw new Error("Unexpected fixture RPC");},
    storage:{from:(bucket:string)=>{assert.equal(bucket,"course-media");return {createSignedUrl:async(path:string,lifetime:number)=>{signed++;assert.equal(lifetime,60);return {data:{signedUrl:`https://fixture.test/storage/v1/object/sign/course-media/${path}?token=fixture`},error:null};}};}}};
  const handler=createNativeCourseMediaHandler({createClient:(()=>client) as unknown as Parameters<typeof createNativeCourseMediaHandler>[0]["createClient"],
    getEnv:key=>({SUPABASE_URL:"https://fixture.test",SUPABASE_ANON_KEY:"anon",SUPABASE_SERVICE_ROLE_KEY:"service"})[key]});
  const send=(operation:unknown,headers:Record<string,string>={})=>handler(new Request("https://fixture.test/functions/v1/course-media",{method:"POST",
    headers:{authorization:"Bearer fixture.jwt.signature","content-type":"application/json",...headers},body:JSON.stringify(operation)}));
  return {send,calls,signed:()=>signed};
}
Deno.test("native status uses real caller RPC and discloses no path",async()=>{
 const f=fixture(),r=await f.send({operation:"media.status",operationId:id(5)});assert.equal(r.status,200);assert.deepEqual(await r.json(),{data:null});assert.equal(f.signed(),0);
});
Deno.test("revoked native account cannot call a media RPC",async()=>{
 const f=fixture({revoked:true}),r=await f.send({operation:"media.status",operationId:id(5)});assert.equal(r.status,401);assert.equal(f.calls.length,0);
});
Deno.test("native media read checks exact path and authority again after signing",async()=>{
 const op={operation:"media.read",versionId:id(6),blockId:id(7),assetId:id(1),range:null};
 const f=fixture(),r=await f.send(op);assert.equal(r.status,200);assert.equal((await r.json()).data.assetId,id(1));assert.equal(f.calls.length,2);
 const foreign=fixture({wrongPath:true});assert.equal((await foreign.send(op)).status,502);assert.equal(foreign.signed(),0);
 const revoked=fixture({revokeAfterSign:true});assert.equal((await revoked.send(op)).status,403);
});
Deno.test("native reads reject byte-range misuse and unauthorized origins",async()=>{
 const f=fixture();assert.equal((await f.send({operation:"media.read",versionId:id(6),blockId:id(7),assetId:id(1),range:{start:0,end:5}})).status,400);
 assert.equal((await f.send({operation:"media.status",operationId:id(5)},{origin:"https://foreign.test"})).status,403);
});
