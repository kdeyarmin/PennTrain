import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  canonicalEntryIdentity,
  type ExclusionListEntryRow,
  leieEntryFromRow,
  leieFingerprint,
  parseLeieDate,
  parseLeieStageCursor,
  stageLeieRows,
} from "./leieStaging.ts";

const UNIT_SEPARATOR = String.fromCharCode(31);

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    LASTNAME: "SMITH", FIRSTNAME: "JOHN", MIDNAME: "Q", BUSNAME: "", GENERAL: "", SPECIALTY: "",
    UPIN: "", NPI: "1234567890", DOB: "19700102", ADDRESS: "", CITY: "", STATE: "", ZIP: "",
    EXCLTYPE: "1128a1", EXCLDATE: "20200319", REINDATE: "00000000", WAIVERDATE: "00000000",
    WVRSTATE: "", ...overrides,
  };
}

async function* rowsOf(items: Record<string, string>[]): AsyncIterable<Record<string, string>> {
  for (const item of items) yield item;
}

interface Recorded {
  chunks: ExclusionListEntryRow[][];
  progress: { chunk: number; entries: number; fingerprint: string }[];
}

function recorder(): Recorded & {
  stageChunk: (entries: ExclusionListEntryRow[]) => Promise<void>;
  onProgress: (cursor: { chunk: number; entries: number; fingerprint: string }) => Promise<void>;
} {
  const chunks: ExclusionListEntryRow[][] = [];
  const progress: { chunk: number; entries: number; fingerprint: string }[] = [];
  return {
    chunks,
    progress,
    stageChunk: (entries) => {
      chunks.push(entries);
      return Promise.resolve();
    },
    onProgress: (cursor) => {
      progress.push({ ...cursor });
      return Promise.resolve();
    },
  };
}

Deno.test("parseLeieDate reads LEIE's YYYYMMDD and treats its zero sentinel as absent", () => {
  assertEquals(parseLeieDate("20200319"), "2020-03-19");
  assertEquals(parseLeieDate("00000000"), null);
  assertEquals(parseLeieDate(""), null);
  assertEquals(parseLeieDate(undefined), null);
  // A malformed length is absent rather than a silently wrong date.
  assertEquals(parseLeieDate("2020031"), null);
});

Deno.test("leieEntryFromRow drops business-only exclusions", () => {
  // complete_exclusion_source_refresh rejects a snapshot containing a record with no last name,
  // so a business-only row must never reach staging: it would fail the whole refresh at the end,
  // after every chunk had already been written.
  assertEquals(leieEntryFromRow(row({ LASTNAME: "", BUSNAME: "ACME HOME CARE INC" })), null);
  assertEquals(leieEntryFromRow(row({ LASTNAME: "   " })), null);
  const entry = leieEntryFromRow(row());
  assert(entry);
  assertEquals(entry.last_name, "SMITH");
  assertEquals(entry.dob, "1970-01-02");
  assertEquals(entry.reinstate_date, null);
});

Deno.test("canonicalEntryIdentity matches exclusion_source_record_key's field order and separator", () => {
  // The database hashes these twelve fields joined by chr(31) and dedups the staged rows on the
  // result. If this drifts from that, the count the worker reports and the count
  // complete_exclusion_source_refresh finds diverge on every duplicate the source contains, and
  // the refresh fails at the handshake with a count mismatch nobody can explain.
  const entry = leieEntryFromRow(row())!;
  assertEquals(
    canonicalEntryIdentity(entry),
    [
      "oig_leie", "SMITH", "JOHN", "Q", "", "1970-01-02", "1128a1", "2020-03-19", "", "",
      "1234567890", "",
    ].join(UNIT_SEPARATOR),
  );
  // The separator is load-bearing: without it these two collide.
  const a = leieEntryFromRow(row({ FIRSTNAME: "JOHNQ", MIDNAME: "" }))!;
  const b = leieEntryFromRow(row({ FIRSTNAME: "JOHN", MIDNAME: "Q" }))!;
  assertNotEquals(canonicalEntryIdentity(a), canonicalEntryIdentity(b));
});

Deno.test("parseLeieStageCursor accepts a real cursor and rejects anything else", () => {
  assertEquals(parseLeieStageCursor({ chunk: 3, entries: 3000, fingerprint: "abc" }), {
    chunk: 3,
    entries: 3000,
    fingerprint: "abc",
  });
  assertEquals(parseLeieStageCursor(null), null);
  assertEquals(parseLeieStageCursor("3"), null);
  // A cursor without a fingerprint cannot be checked against the file, so it cannot be trusted
  // to skip anything.
  assertEquals(parseLeieStageCursor({ chunk: 3, entries: 3000 }), null);
  assertEquals(parseLeieStageCursor({ chunk: -1, fingerprint: "abc" }), null);
  assertEquals(parseLeieStageCursor({ chunk: 1.5, fingerprint: "abc" }), null);
});

Deno.test("leieFingerprint changes when the published file changes", () => {
  const august = new Headers({ "content-length": "15578603", "last-modified": "Mon, 10 Aug 2026 13:18:45 GMT" });
  const september = new Headers({ "content-length": "15612880", "last-modified": "Wed, 09 Sep 2026 12:02:11 GMT" });
  assertEquals(leieFingerprint(august), leieFingerprint(new Headers(august)));
  assertNotEquals(leieFingerprint(august), leieFingerprint(september));
});

Deno.test("a full pass stages every chunk, dedups, and reports the whole-file total", async () => {
  const rec = recorder();
  const items = [
    ...Array.from({ length: 5 }, (_, i) => row({ NPI: `100000000${i}` })),
    // A duplicate of the first: the database would collapse it on (snapshot_id,
    // source_record_key), so the worker must not count it either.
    row({ NPI: "1000000000" }),
    // Business-only rows never reach staging.
    row({ LASTNAME: "", BUSNAME: "ACME" }),
    ...Array.from({ length: 2 }, (_, i) => row({ NPI: `200000000${i}` })),
  ];
  const outcome = await stageLeieRows({
    rows: rowsOf(items),
    fingerprint: "fp-1",
    priorCursor: null,
    batchSize: 3,
    progressEveryChunks: 10,
    deadlineAt: Number.MAX_SAFE_INTEGER,
    now: () => 0,
    stageChunk: rec.stageChunk,
    onProgress: rec.onProgress,
  });

  assertEquals(outcome.completed, true);
  assertEquals(outcome.totalEntries, 7);
  assertEquals(outcome.resumedFromChunk, 0);
  assertEquals(rec.chunks.map((c) => c.length), [3, 3, 1]);
  assertEquals(outcome.cursor, { chunk: 3, entries: 7, fingerprint: "fp-1" });
  // Progress is always recorded at the end, whatever the interval.
  assertEquals(rec.progress.at(-1), { chunk: 3, entries: 7, fingerprint: "fp-1" });
});

Deno.test("running out of budget parks on a chunk boundary with a durable cursor", async () => {
  const rec = recorder();
  let clock = 0;
  const outcome = await stageLeieRows({
    rows: rowsOf(Array.from({ length: 10 }, (_, i) => row({ NPI: `10000000${String(i).padStart(2, "0")}` }))),
    fingerprint: "fp-1",
    priorCursor: null,
    batchSize: 2,
    progressEveryChunks: 1,
    deadlineAt: 100,
    // Two chunks fit; the deadline lands during the third boundary check.
    now: () => (clock += 40),
    stageChunk: rec.stageChunk,
    onProgress: rec.onProgress,
  });

  assertEquals(outcome.completed, false);
  // Whole chunks only -- a cursor pointing into the middle of one could not be trusted.
  assertEquals(outcome.cursor.chunk, rec.chunks.length);
  assertEquals(outcome.cursor.entries, rec.chunks.length * 2);
  // Parking is not failing: the staged chunks stay, and totalEntries is NOT the whole file, so a
  // caller must not hand it to complete_exclusion_source_refresh.
  assert(outcome.totalEntries < 10);
  assertEquals(rec.progress.at(-1)?.chunk, outcome.cursor.chunk);
});

Deno.test("a resume with the same file skips staged chunks but still counts them", async () => {
  const rec = recorder();
  const items = Array.from({ length: 10 }, (_, i) => row({ NPI: `10000000${String(i).padStart(2, "0")}` }));
  const outcome = await stageLeieRows({
    rows: rowsOf(items),
    fingerprint: "fp-1",
    priorCursor: { chunk: 3, entries: 6, fingerprint: "fp-1" },
    batchSize: 2,
    progressEveryChunks: 10,
    deadlineAt: Number.MAX_SAFE_INTEGER,
    now: () => 0,
    stageChunk: rec.stageChunk,
    onProgress: rec.onProgress,
  });

  assertEquals(outcome.completed, true);
  assertEquals(outcome.resumedFromChunk, 3);
  // Only the last two chunks are re-sent.
  assertEquals(rec.chunks.length, 2);
  assertEquals(rec.chunks.flat().map((e) => e.npi), ["1000000006", "1000000007", "1000000008", "1000000009"]);
  // The count handed to the completion handshake is the whole file, not this pass's share -- the
  // database holds all ten, and a count of four would fail the refresh at the very last step.
  assertEquals(outcome.totalEntries, 10);
  assertEquals(outcome.cursor.chunk, 5);
});

Deno.test("a resume against a republished file ignores the cursor and restages", async () => {
  const rec = recorder();
  const items = Array.from({ length: 6 }, (_, i) => row({ NPI: `10000000${String(i).padStart(2, "0")}` }));
  const outcome = await stageLeieRows({
    rows: rowsOf(items),
    fingerprint: "fp-SEPTEMBER",
    // The cursor was written against last month's bytes. Chunk boundaries are byte-determined,
    // so skipping by index would skip rows this file has never staged -- and the refresh would
    // activate a snapshot missing them.
    priorCursor: { chunk: 2, entries: 4, fingerprint: "fp-AUGUST" },
    batchSize: 2,
    progressEveryChunks: 10,
    deadlineAt: Number.MAX_SAFE_INTEGER,
    now: () => 0,
    stageChunk: rec.stageChunk,
    onProgress: rec.onProgress,
  });

  assertEquals(outcome.resumedFromChunk, 0);
  assertEquals(rec.chunks.length, 3);
  assertEquals(outcome.totalEntries, 6);
});

Deno.test("progress is recorded on the configured interval", async () => {
  const rec = recorder();
  await stageLeieRows({
    rows: rowsOf(Array.from({ length: 12 }, (_, i) => row({ NPI: `10000000${String(i).padStart(2, "0")}` }))),
    fingerprint: "fp-1",
    priorCursor: null,
    batchSize: 1,
    progressEveryChunks: 5,
    deadlineAt: Number.MAX_SAFE_INTEGER,
    now: () => 0,
    stageChunk: rec.stageChunk,
    onProgress: rec.onProgress,
  });
  // Chunks 5 and 10, then the final call after the stream ends.
  assertEquals(rec.progress.map((p) => p.chunk), [5, 10, 12]);
});
