import { strict as assert } from "node:assert";
import { createLearningPackageHttpHandler, boundedPackageBody } from "../_shared/learningPackageHttp.ts";
import { PackageIngestionError } from "../_shared/learningPackageIngestion.ts";
import { zipSync } from "npm:fflate@0.8.3";
import { readPackageArchive, packageSha256 } from "../_shared/learningPackageArchive.ts";

Deno.test("upload rejects anonymous callers before multipart allocation",async()=>{
  const handler=createLearningPackageHttpHandler({mode:"upload",authorize:async()=>{throw new PackageIngestionError(401,"Sign in");}});
  assert.equal((await handler(new Request("https://local/upload",{method:"POST",body:"not multipart"}))).status,401);
});
Deno.test("upload streaming limit does not trust a missing content length",async()=>{
  const req=new Request("https://local/upload",{method:"POST",body:new Uint8Array(9)});
  await assert.rejects(()=>boundedPackageBody(req,8),/size limit/);
});
Deno.test("upload rejects oversized declared body before reading it",async()=>{
  const req=new Request("https://local/upload",{method:"POST",headers:{"content-length":"5000"},body:"x"});
  await assert.rejects(()=>boundedPackageBody(req,8),/size limit/);
});
Deno.test("aborting a stalled upload releases the pending reader",async()=>{
  const controller=new AbortController();let cancelled=false;
  const req=new Request("https://local/upload",{method:"POST",signal:controller.signal,body:new ReadableStream({cancel(){cancelled=true;}}),duplex:"half"} as RequestInit);
  const pending=boundedPackageBody(req,8);controller.abort();
  await assert.rejects(()=>pending,/timed out/);assert.equal(cancelled,true);
});
Deno.test("native multipart upload binds actual bytes and final current-authority receipt",async()=>{
  const id=(n:number)=>`22000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const bytes=zipSync({"index.html":new TextEncoder().encode("<html>Original</html>")});const sha=await packageSha256(bytes);
  const operation={operation:"upload",requestId:id(1),versionId:id(2),sourceRevision:"a".repeat(64),reason:"Synthetic original upload",standard:"xapi",sourceSha256:sha,sourceBytes:bytes.byteLength};
  const calls:string[]=[];
  const handler=createLearningPackageHttpHandler({mode:"upload",authorize:async()=>({context:async()=>({sourceRevision:"a".repeat(64)}),ports:{
    codec:{readArchive:readPackageArchive,zipFiles:files=>zipSync(files)},
    prepare:async request=>{assert.deepEqual(request,operation);calls.push("prepare");return {result:null,operation:"upload",operationId:id(3),packageId:id(4),versionId:id(2),source:{bucket:"learning-package-originals",path:"global/source.zip",sha256:sha,bytes:bytes.byteLength},originalPath:"global/source.zip",runtimePrefix:`managed/${id(3)}/`};},
    upload:async(bucket,path,original)=>{assert.equal(bucket,"learning-package-originals");assert.equal(path,"global/source.zip");assert.deepEqual(original,bytes);calls.push("upload");return "created";},
    download:async()=>null,record:async()=>{calls.push("record");},
    finish:async()=>{calls.push("finish");return {operationId:id(3),packageId:id(4),versionId:id(2),sourceRevision:"b".repeat(64),status:"pending",sourceSha256:sha,runtimeSha256:null,entryPoint:null};},
  }})});
  const form=new FormData();form.set("request",JSON.stringify(operation));form.set("file",new Blob([bytes]),"original.zip");
  const response=await handler(new Request("https://local/upload",{method:"POST",body:form}));
  assert.equal(response.status,200);assert.equal((await response.json()).sourceSha256,sha);assert.deepEqual(calls,["prepare","upload","record","finish"]);
});
