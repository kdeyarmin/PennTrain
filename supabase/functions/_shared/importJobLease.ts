// Take the durable-worker claim before applying anything to a customer's data.
//
// `process-data-import-jobs` claims any import job in 'ready' or 'applying' whose claim is absent
// or expired and applies every `data_import_rows` row still marked 'valid'. A browser apply is
// exactly that shape -- the importers here walk the CSV in chunks and hold the job at 'applying'
// between them -- and until 20260805150000 nothing on this side ever wrote `claim_expires_at`.
// Both sides then applied the same rows: the worker took the ones the browser had not reached,
// the browser reached them and applied them again (its loop reads the CSV, not the ledger), and
// the customer got duplicate employees, residents, credentials, contacts, assessments and
// incidents from an import that reported success on both sides.
//
// `record_data_import_chunk` now holds the claim for its caller and refuses when someone else
// holds a live one, so calling it with an empty chunk and no status change is an atomic lease
// acquisition. It must happen BEFORE the first row is written -- discovering the conflict when
// the receipt is recorded is too late, the duplicates already exist.
export async function acquireImportJobLease(
  // deno-lint-ignore no-explicit-any
  client: any,
  jobId: string,
): Promise<string | null> {
  const { error } = await client.rpc("record_data_import_chunk", {
    p_job_id: jobId,
    p_rows: [],
    p_job_status: null,
    p_last_error: null,
  });
  return error ? (error.message ?? "Import job is already being applied") : null;
}
