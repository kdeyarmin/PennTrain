import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { streamOrganizationTableCsv } from "./organizationExportCsv.ts";

Deno.test("CSV export drains each page before requesting another and preserves escaping", async () => {
  const events: string[] = [];
  const chunks: string[] = [];
  let calls = 0;
  const count = await streamOrganizationTableCsv(async (cursor) => {
    events.push(`fetch:${cursor.afterId ?? "start"}`);
    if (calls++ === 0) {
      assertEquals(cursor, { offset: 0, afterId: null });
      return [{ id: "a", name: '=formula,"quoted"' }, { id: "b", name: "line\nbreak" }];
    }
    assertEquals(cursor, { offset: 0, afterId: "b" });
    assertEquals(chunks.length, 3);
    return [{ id: "c", name: null }];
  }, {
    push: async (chunk) => { await Promise.resolve(); events.push("write"); chunks.push(new TextDecoder().decode(chunk)); },
    finish: async () => { events.push("finish"); },
  }, 2);
  assertEquals(count, 3);
  assertEquals(events, ["fetch:start", "write", "write", "write", "fetch:b", "write", "finish"]);
  assertEquals(chunks.join(""), '"id","name"\r\n"a","\'=formula,""quoted"""\r\n"b","line\nbreak"\r\n"c",\r\n');
});

Deno.test("CSV export uses offset only for tables without id and completes empty tables", async () => {
  const cursors: unknown[] = [];
  let finished = false;
  const count = await streamOrganizationTableCsv(async (cursor) => {
    cursors.push(cursor);
    return cursor.offset === 0 ? [{ value: "one" }] : [];
  }, { push: async () => {}, finish: async () => { finished = true; } }, 1);
  assertEquals(cursors, [{ offset: 0, afterId: null }, { offset: 1, afterId: null }]);
  assertEquals(count, 1);
  assertEquals(finished, true);
  assertEquals(await streamOrganizationTableCsv(async () => [], { push: async () => { throw new Error("empty must not write"); }, finish: async () => {} }), 0);
});

Deno.test("CSV export stops reading on cancellation or changed schema", async () => {
  let calls = 0;
  await assertRejects(() => streamOrganizationTableCsv(async () => {
    calls++; return [{ id: "a" }];
  }, { push: async () => { throw new Error("cancelled"); }, finish: async () => {} }, 1), Error, "cancelled");
  assertEquals(calls, 1);
  await assertRejects(() => streamOrganizationTableCsv(async () => calls++ === 1
    ? [{ id: "a" }]
    : [{ id: "b", new_column: "must not disappear" }],
  { push: async () => {}, finish: async () => {} }, 1), Error, "schema changed");
});

Deno.test("CSV export refuses a dropped column while preserving explicit null values", async () => {
  let calls = 0;
  let finished = false;
  const chunks: string[] = [];
  await assertRejects(() => streamOrganizationTableCsv(async () => calls++ === 0
    ? [{ id: "a", note: "original" }, { id: "b", note: null }]
    : [{ id: "c" }], {
      push: async (chunk) => { chunks.push(new TextDecoder().decode(chunk)); },
      finish: async () => { finished = true; },
    }, 2), Error, "schema changed");
  assertEquals(calls, 2);
  assertEquals(chunks.join(""), '"id","note"\r\n"a","original"\r\n"b",\r\n');
  assertEquals(finished, false);
});
