// Streaming, resumable staging for the OIG LEIE exclusion list.
//
// WHY THIS IS ITS OWN MODULE. The 2026-08-12 monthly refresh died inside the parser, before a
// single row was staged, and left its run 'staging' forever (BACKLOG.md I28). The deployed code
// read the whole 15.6 MB response with `resp.text()`, parsed all 83,842 rows into one array,
// mapped that into a second array whose entries each retained `raw: row` -- so the first could not
// be collected -- and then built a dedup Map over the lot. Measured against the real file that
// peaks at 386 MB RSS; a Supabase Edge Function gets 256 MB.
//
// The logic below holds one batch plus the identity set instead: the same 80,355 entries at
// 147.5 MB peak and 1.00 s of CPU, against the platform's 2 s. It takes its stream, its clock and
// its writer as arguments so the resume rules can be tested without a network or a database --
// which is the part that was previously untestable, and therefore untested.

export interface ExclusionListEntryRow {
  source: "oig_leie" | "sam_exclusions";
  last_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  business_name: string | null;
  dob: string | null;
  exclusion_type: string | null;
  exclusion_date: string | null;
  reinstate_date: string | null;
  waiver_date: string | null;
  npi: string | null;
  upin: string | null;
  raw: Record<string, unknown>;
}

// Durable staging progress, stored on the refresh run by record_exclusion_stage_progress.
export interface LeieStageCursor {
  // Chunks fully staged. The unit is chunks rather than rows because a chunk is what lands
  // atomically; a cursor pointing into the middle of one could not be trusted.
  chunk: number;
  entries: number;
  // Identifies the bytes those chunks were parsed from. Skipping a chunk on resume is only sound
  // if the file has not changed underneath, and OIG republishes this list monthly.
  fingerprint: string;
}

export interface LeieStageOutcome {
  completed: boolean;
  cursor: LeieStageCursor;
  // Distinct entries across the WHOLE file. Only meaningful once completed: it is what
  // complete_exclusion_source_refresh checks the staged row count against, and a partial pass has
  // not read the rest of the file yet.
  totalEntries: number;
  resumedFromChunk: number;
}

export const LEIE_CSV_URL = "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv";

export const LEIE_COLUMNS = [
  "LASTNAME", "FIRSTNAME", "MIDNAME", "BUSNAME", "GENERAL", "SPECIALTY", "UPIN", "NPI", "DOB",
  "ADDRESS", "CITY", "STATE", "ZIP", "EXCLTYPE", "EXCLDATE", "REINDATE", "WAIVERDATE", "WVRSTATE",
];

// Progress is recorded every this many staged chunks rather than every chunk: often enough that a
// resume redoes at most this much work and that a stall shows up well inside the reconciler's
// six-hour window, rare enough not to double the round trips staging itself costs.
export const LEIE_PROGRESS_EVERY_CHUNKS = 10;

// Must produce the same string public.exclusion_source_record_key() hashes -- the same fields, in
// the same order, joined by the same unit separator (chr(31)). The database dedups the staged rows
// on that key, so if the two ever disagreed the count the worker reports and the count
// complete_exclusion_source_refresh finds would diverge on every duplicate the source contains.
export function canonicalEntryIdentity(entry: ExclusionListEntryRow): string {
  return [
    entry.source,
    entry.last_name,
    entry.first_name,
    entry.middle_name,
    entry.business_name,
    entry.dob,
    entry.exclusion_type,
    entry.exclusion_date,
    entry.reinstate_date,
    entry.waiver_date,
    entry.npi,
    entry.upin,
  ].map((value) => String(value ?? "").trim()).join("\u001f");
}

export function parseLeieDate(value: string | undefined): string | null {
  if (!value || value === "00000000" || value.length !== 8) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

export function leieFingerprint(headers: Headers): string {
  return [
    headers.get("content-length") ?? "",
    headers.get("last-modified") ?? "",
    headers.get("etag") ?? "",
  ].join("|");
}

export function leieEntryFromRow(row: Record<string, string>): ExclusionListEntryRow | null {
  // Business-only exclusions (blank LASTNAME) cannot match an individual employee's name, and
  // complete_exclusion_source_refresh rejects a snapshot containing one.
  const lastName = row.LASTNAME?.trim();
  if (!lastName) return null;
  return {
    source: "oig_leie",
    last_name: lastName,
    first_name: row.FIRSTNAME?.trim() || null,
    middle_name: row.MIDNAME?.trim() || null,
    business_name: row.BUSNAME?.trim() || null,
    dob: parseLeieDate(row.DOB),
    exclusion_type: row.EXCLTYPE?.trim() || null,
    exclusion_date: parseLeieDate(row.EXCLDATE),
    reinstate_date: parseLeieDate(row.REINDATE),
    waiver_date: parseLeieDate(row.WAIVERDATE),
    npi: row.NPI?.trim() || null,
    upin: row.UPIN?.trim() || null,
    raw: row,
  };
}

export function parseLeieStageCursor(value: unknown): LeieStageCursor | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LeieStageCursor>;
  if (
    typeof candidate.chunk === "number" && Number.isInteger(candidate.chunk) && candidate.chunk >= 0 &&
    typeof candidate.fingerprint === "string" && candidate.fingerprint.length > 0
  ) {
    return {
      chunk: candidate.chunk,
      entries: Number(candidate.entries) || 0,
      fingerprint: candidate.fingerprint,
    };
  }
  return null;
}

export interface StageLeieOptions {
  rows: AsyncIterable<Record<string, string>>;
  fingerprint: string;
  priorCursor: LeieStageCursor | null;
  batchSize: number;
  progressEveryChunks: number;
  deadlineAt: number;
  now: () => number;
  stageChunk: (entries: ExclusionListEntryRow[]) => Promise<void>;
  onProgress: (cursor: LeieStageCursor) => Promise<void>;
}

export async function stageLeieRows(options: StageLeieOptions): Promise<LeieStageOutcome> {
  const { rows, fingerprint, priorCursor, batchSize, progressEveryChunks, deadlineAt, now,
    stageChunk, onProgress } = options;

  // A cursor from a different file is not a cursor. Chunk boundaries are byte-determined, so
  // skipping by chunk index is only sound when the bytes are the same bytes; when OIG republishes
  // mid-resume the cursor is simply dropped and this pass restages from the beginning. That costs
  // round trips and changes nothing -- the staging upsert does nothing on conflict.
  const resumedFromChunk = priorCursor && priorCursor.fingerprint === fingerprint
    ? priorCursor.chunk
    : 0;

  const seen = new Set<string>();
  let batch: ExclusionListEntryRow[] = [];
  let chunk = 0;
  let total = 0;
  let cursor: LeieStageCursor = { chunk: resumedFromChunk, entries: 0, fingerprint };

  async function flush(): Promise<void> {
    const index = chunk;
    chunk += 1;
    const pending = batch;
    batch = [];
    // Chunks an earlier pass already staged are durable. They still count toward `total`, because
    // the completion handshake compares the database against the whole file, not against this
    // pass's share of it.
    if (index < resumedFromChunk) return;
    await stageChunk(pending);
    cursor = { chunk, entries: total, fingerprint };
    if (chunk % progressEveryChunks === 0) await onProgress(cursor);
  }

  for await (const row of rows) {
    const entry = leieEntryFromRow(row);
    if (!entry) continue;
    const identity = canonicalEntryIdentity(entry);
    if (seen.has(identity)) continue;
    seen.add(identity);
    total += 1;
    batch.push(entry);
    if (batch.length < batchSize) continue;
    await flush();
    // Park only on a chunk boundary, so what is staged is always a whole number of chunks.
    // Leaving the loop cancels the stream, which closes the connection.
    if (now() >= deadlineAt) {
      await onProgress(cursor);
      return { completed: false, cursor, totalEntries: total, resumedFromChunk };
    }
  }
  if (batch.length > 0) await flush();

  cursor = { chunk, entries: total, fingerprint };
  await onProgress(cursor);
  return { completed: true, cursor, totalEntries: total, resumedFromChunk };
}
