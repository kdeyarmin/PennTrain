import { strict as assert } from "node:assert";
import { createLearningPackageHttpHandler, boundedPackageBody } from "../_shared/learningPackageHttp.ts";
import { PackageIngestionError } from "../_shared/learningPackageIngestion.ts";

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
