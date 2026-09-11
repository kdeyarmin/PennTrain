import { strict as assert } from "node:assert";
import { zipSync } from "npm:fflate@0.8.3";
import { packageSha256, readPackageArchive } from "../_shared/learningPackageArchive.ts";
import { derivePackageRuntime, executePackageOperation, PackageIngestionError, parsePackageOperation, type PackageAccept, type PackageIngestionPorts } from "../_shared/learningPackageIngestion.ts";
import { createLearningPackageHttpHandler } from "../_shared/learningPackageHttp.ts";

const id = (n: number) => `22000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const codec = { readArchive: readPackageArchive, zipFiles: (files: Record<string, Uint8Array>) => zipSync(files, { level: 6, mtime: new Date(2000, 0, 1, 0, 0, 0) }) };
const original = codec.zipFiles({ "index.html": new TextEncoder().encode("<html><body>Authored source</body></html>"), "lesson.txt": new TextEncoder().encode("Lesson one") });
async function fixture() {
  const sha = await packageSha256(original);
  const operation: PackageAccept = { operation: "accept", requestId: id(1), packageId: id(2), sourceRevision: "a".repeat(64), reason: "Reviewed this authored package", entryPoint: "index.html" };
  const files = new Map<string, Uint8Array>([["learning-packages/legacy/original.zip", original.slice()]]);
  const calls: string[] = []; let proof: Parameters<PackageIngestionPorts["record"]>[0] | null = null;
  let revoked = false; let lostFinish = false; let committed: unknown = null;
  const ports: PackageIngestionPorts = {
    codec,
    async prepare(input) { calls.push("prepare"); if(revoked) throw new PackageIngestionError(403,"Revoked"); return committed ? { result: committed } : {
      result: null, operation: input.operation, operationId: id(3), packageId: id(2), versionId: id(4),
      source: { bucket: "learning-packages", path: "legacy/original.zip", sha256: sha, bytes: original.byteLength },
      originalPath: "global/course/package/original.zip", runtimePrefix: `managed/${id(3)}/`, bridgeSha256: input.bridgeSha256,
    }; },
    async download(bucket,path) { calls.push(`get:${bucket}/${path}`); const bytes=files.get(`${bucket}/${path}`); return bytes ? new Blob([bytes as BlobPart]) : null; },
    async upload(bucket,path,bytes) { calls.push(`put:${bucket}/${path}`); const key=`${bucket}/${path}`; if(files.has(key)) return "exists"; files.set(key,bytes.slice()); return "created"; },
    async record(value) { calls.push("record"); proof=value; },
    async finish() { calls.push("finish"); if(revoked) throw new PackageIngestionError(403,"Revoked"); assert.ok(proof); committed={operationId:id(3),packageId:id(2),versionId:id(4),sourceRevision:"b".repeat(64),status:"accepted",sourceSha256:sha,runtimeSha256:proof.p_runtime_sha256,entryPoint:proof.p_entry_point}; if(lostFinish){lostFinish=false;throw Error("Synthetic response lost");} return committed; },
  };
  return { operation,ports,files,calls,sha,revoke:()=>{revoked=true;},loseFinish:()=>{lostFinish=true;} };
}
Deno.test("acceptance retains original bytes and writes distinct hash-bound runtime",async()=>{
  const f=await fixture(); const receipt=await executePackageOperation(f.operation,null,f.ports);
  assert.deepEqual(f.files.get("learning-packages/legacy/original.zip"),original);
  assert.deepEqual(f.files.get("learning-package-originals/global/course/package/original.zip"),original);
  const derived=f.files.get(`learning-packages/managed/${id(3)}/${receipt.runtimeSha256}.zip`)!;
  assert.equal(await packageSha256(derived),receipt.runtimeSha256); assert.notEqual(receipt.sourceSha256,receipt.runtimeSha256);
  const html=new TextDecoder().decode(readPackageArchive(derived)["index.html"]);
  assert.match(html,/<script src="carebase\/learning-runtime-bridge.js"><\/script>/);
  assert.ok(f.calls.indexOf("record")<f.calls.indexOf("finish"));
});
Deno.test("runtime derivation has deterministic exact bytes and leaves input untouched",()=>{
  const before=original.slice(); assert.deepEqual(derivePackageRuntime(original,null,codec),derivePackageRuntime(original,null,codec)); assert.deepEqual(before,original);
});
Deno.test("revocation after immutable upload prevents package acceptance",async()=>{
  const f=await fixture(); const record=f.ports.record; f.ports.record=async proof=>{await record(proof);f.revoke();};
  await assert.rejects(()=>executePackageOperation(f.operation,null,f.ports),/Revoked/);
  assert.deepEqual(f.files.get("learning-packages/legacy/original.zip"),original); assert.equal(f.files.size,3);
});
Deno.test("lost final response replays the committed receipt without writing again",async()=>{
  const f=await fixture();f.loseFinish();await assert.rejects(()=>executePackageOperation(f.operation,null,f.ports),/lost/);
  const puts=f.calls.filter(x=>x.startsWith("put:")).length;const result=await executePackageOperation(f.operation,null,f.ports);
  assert.equal(result.status,"accepted");assert.equal(f.calls.filter(x=>x.startsWith("put:")).length,puts);
});
Deno.test("lost staging response safely verifies existing immutable objects",async()=>{
  const f=await fixture();const record=f.ports.record;let first=true;
  f.ports.record=async p=>{if(first){first=false;throw Error("staging response lost");}await record(p);};
  await assert.rejects(()=>executePackageOperation(f.operation,null,f.ports),/lost/);const keys=[...f.files.keys()];
  await executePackageOperation(f.operation,null,f.ports);assert.deepEqual([...f.files.keys()],keys);
});
Deno.test("a conflicting existing original is never overwritten or accepted",async()=>{
  const f=await fixture();f.files.set("learning-package-originals/global/course/package/original.zip",new Uint8Array(original.byteLength));
  await assert.rejects(()=>executePackageOperation(f.operation,null,f.ports),/not overwritten/);assert.ok(!f.calls.includes("record"));
});
Deno.test("source content mismatch fails before any storage write",async()=>{
  const f=await fixture(); f.files.set("learning-packages/legacy/original.zip",new Uint8Array(original.byteLength));
  await assert.rejects(()=>executePackageOperation(f.operation,null,f.ports),/hash differs/);assert.ok(!f.calls.some(x=>x.startsWith("put:")));
});
Deno.test("explicit missing entry, base overrides and reserved bridge files fail closed",()=>{
  assert.throws(()=>derivePackageRuntime(original,"missing.html",codec),/existing HTML/);
  assert.throws(()=>derivePackageRuntime(codec.zipFiles({"index.html":new TextEncoder().encode('<html><base href="https://foreign.example/"></html>')}),null,codec),/base URL/);
  assert.throws(()=>derivePackageRuntime(codec.zipFiles({"index.html":new TextEncoder().encode("<html></html>"),"carebase/learning-runtime-bridge.js":new Uint8Array([1])}),null,codec),/reserved/);
});
Deno.test("closed operation parser rejects foreign paths and invalid source identities",async()=>{
  const f=await fixture(); assert.throws(()=>parsePackageOperation({...f.operation,storagePath:"foreign.zip"}),/Invalid/);
  assert.throws(()=>parsePackageOperation({...f.operation,entryPoint:"../index.html"}),/Invalid/);
  assert.throws(()=>parsePackageOperation({...f.operation,sourceRevision:""}),/Invalid/);
});
Deno.test("native HTTP authenticates before parsing and redacts unexpected failures",async()=>{
  let parsed=false; const handler=createLearningPackageHttpHandler({mode:"accept",authorize:async()=>{throw new PackageIngestionError(401,"Sign in");}});
  const request=new Request("https://local/accept",{method:"POST",body:"not json"});Object.defineProperty(request,"json",{value:()=>{parsed=true;}});
  assert.equal((await handler(request)).status,401);assert.equal(parsed,false);
});
Deno.test("legacy native HTTP delegates acceptance through immutable worker",async()=>{
  const f=await fixture();const handler=createLearningPackageHttpHandler({mode:"accept",authorize:async()=>({ports:f.ports,context:async()=>({sourceRevision:"a".repeat(64)})})});
  const response=await handler(new Request("https://local/accept",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({package_id:id(2),request_id:id(1),reason:f.operation.reason,entry_point:"index.html"})}));
  assert.equal(response.status,200);assert.equal((await response.json()).status,"accepted");assert.deepEqual(f.files.get("learning-packages/legacy/original.zip"),original);
});
