import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.14";
import { strFromU8, strToU8, unzipSync } from "npm:fflate@0.8.2";
import {
  computeExportExclusions,
  decideDocumentEmbedding,
  hashWhileForwarding,
  MAX_EMBED_OBJECT_BYTES,
  PLATFORM_INTERNAL_TABLES,
  StreamingZipWriter,
} from "./organizationExportArchive.ts";

Deno.test("decideDocumentEmbedding embeds a valid object within every limit", () => {
  assertEquals(
    decideDocumentEmbedding({
      referenceValid: true,
      objectBytes: 1024,
      maxObjectBytes: MAX_EMBED_OBJECT_BYTES,
      remainingBudgetBytes: 10_000,
      deadlineExceeded: false,
    }),
    { embed: true },
  );
});

Deno.test("decideDocumentEmbedding skips invalid references with the validator's reason", () => {
  assertEquals(
    decideDocumentEmbedding({
      referenceValid: false,
      referenceReason: "organization_path_mismatch",
      objectBytes: 10,
      maxObjectBytes: 100,
      remainingBudgetBytes: 100,
      deadlineExceeded: false,
    }),
    { embed: false, skipReason: "invalid_reference:organization_path_mismatch" },
  );
});

Deno.test("decideDocumentEmbedding enforces the per-object size cap", () => {
  assertEquals(
    decideDocumentEmbedding({
      referenceValid: true,
      objectBytes: MAX_EMBED_OBJECT_BYTES + 1,
      maxObjectBytes: MAX_EMBED_OBJECT_BYTES,
      remainingBudgetBytes: Number.MAX_SAFE_INTEGER,
      deadlineExceeded: false,
    }),
    { embed: false, skipReason: "size_cap_exceeded" },
  );
});

Deno.test("decideDocumentEmbedding enforces the run deadline and the total budget", () => {
  assertEquals(
    decideDocumentEmbedding({
      referenceValid: true,
      objectBytes: 1,
      maxObjectBytes: 100,
      remainingBudgetBytes: 100,
      deadlineExceeded: true,
    }),
    { embed: false, skipReason: "deadline_exceeded" },
  );
  assertEquals(
    decideDocumentEmbedding({
      referenceValid: true,
      objectBytes: 1,
      maxObjectBytes: 100,
      remainingBudgetBytes: 0,
      deadlineExceeded: false,
    }),
    { embed: false, skipReason: "embed_budget_exhausted" },
  );
  assertEquals(
    decideDocumentEmbedding({
      referenceValid: true,
      objectBytes: 60,
      maxObjectBytes: 100,
      remainingBudgetBytes: 50,
      deadlineExceeded: false,
    }),
    { embed: false, skipReason: "embed_budget_exhausted" },
  );
});

Deno.test("decideDocumentEmbedding defers size rules while the size is unknown", () => {
  assertEquals(
    decideDocumentEmbedding({
      referenceValid: true,
      objectBytes: null,
      maxObjectBytes: 100,
      remainingBudgetBytes: 1,
      deadlineExceeded: false,
    }),
    { embed: true },
  );
});

Deno.test("computeExportExclusions partitions the runtime scan honestly", () => {
  const exclusions = computeExportExclusions({
    nonOrganizationTables: [
      "organizations",
      "course_progress",
      "release_flags",
      "facility_assignments",
      "platform_settings",
      "course_progress",
    ],
  });
  assertEquals(exclusions, {
    sharedTables: ["course_progress", "facility_assignments"],
    platformInternalTables: ["platform_settings", "release_flags"],
    exportedSeparately: ["organizations"],
  });
});

Deno.test("computeExportExclusions never drops a table that is not allowlisted", () => {
  const exclusions = computeExportExclusions({
    nonOrganizationTables: ["zz_new_shared_table", "benchmark_snapshots"],
    platformInternalAllowlist: ["benchmark_snapshots"],
  });
  assertEquals(exclusions.sharedTables, ["zz_new_shared_table"]);
  assertEquals(exclusions.platformInternalTables, ["benchmark_snapshots"]);
  assertEquals(exclusions.exportedSeparately, []);
});

Deno.test("PLATFORM_INTERNAL_TABLES stays sorted and free of duplicates", () => {
  const sorted = [...PLATFORM_INTERNAL_TABLES].sort();
  assertEquals([...PLATFORM_INTERNAL_TABLES], sorted);
  assertEquals(new Set(PLATFORM_INTERNAL_TABLES).size, PLATFORM_INTERNAL_TABLES.length);
});

Deno.test("hashWhileForwarding hashes and counts exactly the forwarded bytes", async () => {
  const forwarded: Uint8Array[] = [];
  const { sha256, byteSize } = await hashWhileForwarding(
    [strToU8("a"), strToU8("b"), strToU8("c")],
    // deno-lint-ignore require-await
    async (chunk) => {
      forwarded.push(chunk);
    },
  );
  // SHA-256("abc"), the classic FIPS 180-2 test vector.
  assertEquals(sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assertEquals(byteSize, 3);
  assertEquals(forwarded.map((chunk) => strFromU8(chunk)), ["a", "b", "c"]);
});

async function collectArchive(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of readable) chunks.push(chunk);
  const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    total.set(chunk, offset);
    offset += chunk.length;
  }
  return total;
}

Deno.test("StreamingZipWriter produces a valid archive from buffered and streamed entries", async () => {
  const zip = new StreamingZipWriter();
  const archivePromise = collectArchive(zip.readable);

  await zip.addFile("tables/example.csv", strToU8("id,name\r\n1,Alpha\r\n"));
  const binary = new Uint8Array(300_000);
  for (let i = 0; i < binary.length; i += 1) binary[i] = i % 251;
  const sink = zip.open("files/incident-documents/org/report.pdf", { compress: false });
  const { sha256, byteSize } = await hashWhileForwarding(
    [binary.subarray(0, 100_000), binary.subarray(100_000)],
    (chunk) => sink.push(chunk),
  );
  await sink.finish();
  await zip.addFile("README.txt", strToU8("hello export"));
  zip.end();

  const unpacked = unzipSync(await archivePromise);
  assertEquals(Object.keys(unpacked).sort(), [
    "README.txt",
    "files/incident-documents/org/report.pdf",
    "tables/example.csv",
  ]);
  assertEquals(strFromU8(unpacked["tables/example.csv"]), "id,name\r\n1,Alpha\r\n");
  assertEquals(unpacked["files/incident-documents/org/report.pdf"], binary);
  assertEquals(byteSize, binary.length);
  assertEquals(sha256.length, 64);
});

Deno.test("StreamingZipWriter applies backpressure instead of queueing unboundedly", async () => {
  const zip = new StreamingZipWriter();
  // Do not read yet: producers must stall once the queue's high-water mark is hit.
  const big = new Uint8Array(4 * 1024 * 1024).fill(7);
  let finished = false;
  const producer = zip
    .addFile("files/blob.bin", big, { compress: false })
    .then(() => {
      finished = true;
      zip.end();
    });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(finished, false);
  // Draining the stream releases the producer and completes the archive.
  const archive = await collectArchive(zip.readable);
  await producer;
  assert(finished);
  assertEquals(unzipSync(archive)["files/blob.bin"], big);
});

Deno.test("StreamingZipWriter rejects overlapping entries and surfaces aborts", async () => {
  const zip = new StreamingZipWriter();
  const drain = collectArchive(zip.readable).catch((error) => error);
  const sink = zip.open("a.txt", { compress: true });
  assertThrows(() => zip.open("b.txt", { compress: true }), Error, "already open");
  await sink.push(strToU8("partial"));
  zip.abort(new Error("build failed"));
  await assertRejects(() => sink.push(strToU8("more")), Error, "build failed");
  const drained = await drain;
  assert(drained instanceof Error);
  assertEquals(drained.message, "build failed");
});
