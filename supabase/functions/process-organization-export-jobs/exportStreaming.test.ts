import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.3";
import { buildExport, collectDocumentReferences } from "./handler.ts";

const org = "e5200000-0000-4000-8000-000000000001";
function documentClient(pages: Record<string, Array<Record<string, unknown>[]>>, queries: Array<Record<string, unknown>>) {
  return { from: (table: string) => {
    const query: Record<string, unknown> = { table }; queries.push(query);
    const builder = {
      select: (columns: string) => { query.columns = columns; return builder; },
      eq: (column: string, value: string) => { query[column] = value; return builder; },
      order: () => builder,
      limit: (value: number) => { query.limit = value; return builder; },
      gt: (_column: string, value: string) => { query.after = value; return builder; },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: pages[table]?.shift() ?? [], error: null }),
    };
    return builder;
  } };
}

Deno.test("document reference sweep selects only storage references and advances keysets", async () => {
  const queries: Array<Record<string, unknown>> = [];
  const first = Array.from({ length: 1000 }, (_, index) => ({ id: `doc-${String(index).padStart(4, "0")}`, storage_bucket: "external-uploads", storage_path: `${org}/facility/${index}.pdf` }));
  const client = documentClient({ training_documents: [first, [{ id: "doc-1000", storage_bucket: "external-uploads", storage_path: "another-org/secret.pdf" }]] }, queries);
  const refs = await collectDocumentReferences(client as never, org);
  assertEquals(refs.length, 1001);
  assertEquals(refs[1000].valid, false);
  assertEquals(refs[1000].invalidReason, "organization_path_mismatch");
  assertEquals(queries[1].after, "doc-0999");
  for (const query of queries) { assertEquals(query.columns, "id,storage_bucket,storage_path"); assertEquals(query.organization_id, org); assertEquals(query.limit, 1000); }
  assertEquals(Object.keys(refs[0]).sort(), ["bucket", "invalidReason", "path", "recordId", "sourceTable", "valid"]);
});

Deno.test("document reference sweep fails a repeating page instead of looping indefinitely", async () => {
  const page = Array.from({ length: 1000 }, (_, index) => ({ id: `doc-${index}`, storage_bucket: "external-uploads", storage_path: `${org}/file.pdf` }));
  await assertRejects(() => collectDocumentReferences(documentClient({ training_documents: [page, page] }, []) as never, org), Error, "document page did not advance");
});

Deno.test("export worker streams a multi-page table into one complete CSV in the uploaded archive", async () => {
  const rpcCalls: Array<Record<string, unknown>> = [];
  const chunks: Uint8Array[] = [];
  const first = Array.from({ length: 1000 }, (_, index) => ({ id: `row-${String(index).padStart(4, "0")}`, note: index === 0 ? '=FORMULA,"quoted"' : `record ${index}` }));
  const docs = documentClient({}, []);
  const client = {
    from: (table: string) => table === "organizations" ? { select: () => ({ eq: () => ({ single: async () => ({ data: { id: org, name: "Export fixture" }, error: null }) }) }) } : docs.from(table),
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "get_organization_export_catalog") return { data: [{ table_name: "fixture_records" }], error: null };
      if (name === "get_organization_export_exclusions" || name === "export_organization_consent_withholding") return { data: [], error: null };
      if (name === "export_organization_table") {
        rpcCalls.push(args!);
        return { data: args?.p_after_id ? [{ id: "row-1000", note: "final\nrecord" }] : first, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: { from: () => ({ upload: async (_path: string, stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) chunks.push(chunk); return { error: null }; } }) },
  };
  const result = await buildExport(client as never, { job_id: "export-job", organization_id: org, requested_by: "requester", lock_token: "lock", attempt_count: 1 }, () => { throw new Error("No documents should download"); }, Date.now() + 60_000);
  assertEquals(result.tableCount, 2);
  assertEquals(result.rowCount, 1002);
  assertEquals(rpcCalls.map((args) => ({ offset: args.p_offset, after: args.p_after_id, limit: args.p_limit })), [{ offset: 0, after: null, limit: 1000 }, { offset: 0, after: "row-0999", limit: 1000 }]);
  const archive = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let cursor = 0; for (const chunk of chunks) { archive.set(chunk, cursor); cursor += chunk.length; }
  const files = unzipSync(archive);
  const csv = strFromU8(files["tables/fixture_records.csv"]);
  assertEquals(csv.match(/"id","note"/g)?.length, 1);
  assertEquals(csv.includes('"row-0000","\'=FORMULA,""quoted"""\r\n'), true);
  assertEquals(csv.endsWith('"row-1000","final\nrecord"\r\n'), true);
  assertEquals(result.byteSize, archive.length);
  assertEquals(result.embeddedDocuments, 0);
});
