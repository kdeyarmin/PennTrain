import assert from 'node:assert/strict';
import test from 'node:test';
import {parseMediaHttpRequest} from '../../../supabase/functions/_shared/courseMediaHttp.ts';
import {MediaError} from '../../../supabase/functions/_shared/courseMediaProtocol.ts';
const url='https://fixture.invalid/api/media';
const invalid400=error=>error instanceof MediaError&&error.status===400;
test('malformed base64, UTF-8 and JSON media metadata are typed 400 errors',async()=>{
 for(const encoded of ['A','__8',Buffer.from('{invalid').toString('base64url')]){
  const request=new Request(url,{method:'POST',headers:{'content-type':'application/pdf','x-caremetric-media-request':encoded},body:'%PDF-1.7'});
  await assert.rejects(parseMediaHttpRequest(request),invalid400);
 }
 for(const body of [new Uint8Array([255,255]),'{invalid']){
  await assert.rejects(parseMediaHttpRequest(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body})),invalid400);
 }
});
test('valid metadata and original body limits keep their documented outcomes',async()=>{
 const operation={operation:'media.context',versionId:'23550000-0000-4000-8000-000000000001',blockId:'23550000-0000-4000-8000-000000000002'};
 assert.deepEqual(await parseMediaHttpRequest(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(operation)})),operation);
 await assert.rejects(parseMediaHttpRequest(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(8193)})),error=>error instanceof MediaError&&error.status===413);
});
