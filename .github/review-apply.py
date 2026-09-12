from pathlib import Path
import json

def change(path, old, new):
    p=Path(path); text=p.read_text()
    assert text.count(old)==1, f'Unexpected source: {path}: {old[:70]}'
    p.write_text(text.replace(old,new))

root='artifacts/caremetric-carebase/'
change('supabase/functions/regenerate-course-block/index.ts', 'interface CourseBlockRow {\n  id: string;', 'interface CourseBlockRow {\n  id: string;\n  media_asset_id: string | null;')
change('supabase/functions/regenerate-course-block/index.ts', '''    const { error: updateError } = await callerClient
      .from("course_blocks")
      .update({ body: { script }, video_url: null })
      .eq("id", course_block_id);
    if (updateError) {
      await markFailed(updateError.message);
      return json(req, { error: updateError.message, generation_id: generationId }, 500);
    }''', '''    // Attachment may have changed while the provider was producing the script.
    // Compare at the writer, not just the initial read, so a newly attached
    // immutable video is never paired with a different generated script.
    const { data: updatedBlock, error: updateError } = await callerClient
      .from("course_blocks")
      .update({ body: { script }, video_url: null })
      .eq("id", course_block_id)
      .is("media_asset_id", null)
      .select("id")
      .maybeSingle();
    if (updateError) {
      await markFailed(updateError.message);
      return json(req, { error: updateError.message, generation_id: generationId }, 500);
    }
    if (!updatedBlock) {
      await markFailed("The lesson media changed while the script was generated.");
      return json(req, { error: "The lesson media changed. Review the current attachment before regenerating.", generation_id: generationId }, 409);
    }''')
change(root+'src/lib/courseMediaHash.ts', 'export async function sha256File(file: Blob, chunkSize = 1024 * 1024): Promise<string> {', '''export async function sha256File(file: Blob, chunkSize = 1024 * 1024): Promise<string> {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 16 * 1024 * 1024) {
    throw new RangeError("Hash chunks must be between 1 byte and 16 MiB.");
  }''')
with Path(root+'src/lib/courseMediaHash.test.ts').open('a') as f:
 f.write('''
// Padding boundaries and empty content must agree with the independent runtime.
it("matches Web Crypto across SHA-256 padding and chunk boundaries", async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1025]) {
    const data = Uint8Array.from({ length: size }, (_, i) => i % 251);
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), value => value.toString(16).padStart(2, "0")).join("");
    expect(await sha256File(new Blob([data]), 127)).toBe(expected);
  }
});
it("rejects invalid chunk sizes before reading bytes", async () => {
  const blob = new Blob(["abc"]); const slice = vi.spyOn(blob, "slice");
  for (const size of [0, -1, NaN, Infinity, 0.5, 16 * 1024 * 1024 + 1]) {
    await expect(sha256File(blob, size)).rejects.toBeInstanceOf(RangeError);
  }
  expect(slice).not.toHaveBeenCalled();
});
it("hashes the supported 100 MiB maximum using bounded reads", async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(37);
  const blob = new Blob(Array.from({ length: 100 }, () => chunk));
  const slice = vi.spyOn(blob, "slice");
  const fullRead = vi.spyOn(blob, "arrayBuffer").mockRejectedValue(new Error("Whole-file reads are forbidden"));
  expect(await sha256File(blob)).toBe("HASH_100M");
  expect(fullRead).not.toHaveBeenCalled();
  expect(slice).toHaveBeenCalledTimes(100);
  expect(slice.mock.calls.every(([start = 0, end = 0]) => Number(end) - Number(start) <= 1024 * 1024)).toBe(true);
}, 30_000);
''')
# Keep this fixed digest independent from the browser implementation.
import hashlib
expected=hashlib.sha256(bytes([37])*(1024*1024)*100).hexdigest()
change(root+'src/lib/courseMediaHash.test.ts','HASH_100M',expected)
with Path(root+'src/components/learning/NativeCourseMediaPanel.test.tsx').open('a') as f:
 f.write('''
for (const status of [404,409,410,503]) it(`uses safe upload identity recovery after HTTP ${status}`,async()=>{
 choose(new File(['%PDF-1.7 synthetic'],'Original.pdf',{type:'application/pdf'}));
 h.call.mockRejectedValue(Object.assign(new Error('Synthetic upload outcome'),{status}));
 (button('Upload for review').props.onClick as ()=>void)();
 await vi.waitFor(()=>expect(h.state[2]).toBe(false));expect(h.call).toHaveBeenCalledTimes(1);
 const first=h.call.mock.calls[0][0];
 h.context.data={...(h.context.data as object),sourceRevision:'b'.repeat(64)};
 (button('Upload for review').props.onClick as ()=>void)();
 await vi.waitFor(()=>expect(h.state[2]).toBe(false));expect(h.call).toHaveBeenCalledTimes(2);
 const second=h.call.mock.calls[1][0];
 if(status===503){expect(second).toEqual(first);}
 else {expect(second.requestId).not.toBe(first.requestId);expect(second.sourceRevision).toBe('b'.repeat(64));}
 expect(h.finish).not.toHaveBeenCalled();
});
''')
Path(root+'server/platform-admin-media-review.test.mjs').write_text('''import assert from 'node:assert/strict';
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
''')
change(root+'server/platform-admin-media-database.test.mjs', " assert.equal(sql(`select count(*) from public.course_assignments where course_version_id='${clone}'`),'0','clone copies no learner history');", """ assert.equal(sql(`select count(*) from public.course_assignments where course_version_id='${clone}'`),'0','clone copies no learner history');
 // Prove the trigger itself rejects attached-block identity changes. This uses
 // the privileged fixture connection so a missing column grant cannot mask a
 // broken trigger. Each rejected statement rolls back in its subtransaction.
 for(const assignment of [`id='${randomUUID()}'`,`course_version_id='${clone}'`,`organization_id='${randomUUID()}'`,"block_type='video'"]){
  sql(`do $$ begin
   begin
    update public.course_blocks set ${assignment} where id='${block}';
    raise exception 'Attached block identity update was accepted';
   exception when insufficient_privilege then
    if position('identity of a block' in sqlerrm)=0 then raise; end if;
   end;
  end $$;`);
 }
 assert.equal(sql(`select media_asset_id from public.course_blocks where id='${block}'`),receipt.assetId,'identity attempts preserve the original attached artifact');""")
change('BACKLOG.md','**Last verified against main:** `4adc152954d71a85bda6ae4e64ed8f6dfa15184e`','**Last verified against main:** `58aa26b08a93b10ab343039542b3df6dc579ddc2`')
change('BACKLOG.md','N19 adds course-owned media in an isolated candidate;', 'N19 review fixes add database identity guards, race-safe script writes, typed metadata failures, retry identity tests and bounded 100 MiB hashing coverage in an isolated candidate;')
