import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { escapeLikePattern } from "@/lib/utils";
import {
  canUploadImportDomain,
  importProcessorFunction,
  type ImportDomain,
} from "@/lib/dataImportCenter";

export interface DataImportJobFilters {
  domain?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useDataImportJobs(filters: DataImportJobFilters = {}) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 25;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  return useQuery({
    queryKey: ["data-import-jobs", filters],
    queryFn: async () => {
      let query = supabase
        .from("data_import_jobs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        // Unique tie-break so page boundaries are stable: several jobs queued from one upload
        // share a `created_at`, and paging inside a run of equal keys without it lets Postgres
        // order each request differently.
        .order("id", { ascending: true })
        .range(from, to);
      if (filters.domain && filters.domain !== "all") query = query.eq("domain", filters.domain);
      if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
      if (filters.search?.trim()) {
        const term = escapeLikePattern(filters.search.trim());
        query = query.ilike("original_file_name", `%${term}%`);
      }
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data, total: count ?? 0 };
    },
  });
}

export function useImportJobRows(jobId: string | null) {
  return useQuery({
    queryKey: ["data-import-rows", jobId], enabled: Boolean(jobId),
    queryFn: async () => {
      const { data, error } = await supabase.from("data_import_rows").select("row_number,source_row,errors,warnings,status").eq("job_id", jobId!).order("row_number");
      if (error) throw error;
      return data;
    },
  });
}

export function useImportJobAction(action: "finalize" | "rollback") {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      if (action === "finalize") {
        const { data, error } = await supabase.rpc("finalize_data_import_job", { p_job_id: jobId });
        if (error) throw error;
        return data;
      }

      const primary = await supabase.rpc("rollback_data_import_job", { p_job_id: jobId });
      if (!primary.error) return primary.data;
      if (!/function .* does not exist|Could not find the function|schema cache/i.test(primary.error.message)) {
        throw primary.error;
      }
      const fallback = await supabase.rpc("rollback_employee_import_job", { p_job_id: jobId });
      if (fallback.error) throw fallback.error;
      return fallback.data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["data-import-jobs"] }),
  });
}

export interface DomainImportResult {
  job_id: string;
  totalRows: number;
  succeeded: number;
  failed: number;
  nextOffset: number | null;
  results: Array<{ row: number; success: boolean; action?: string; error?: string; warnings?: string[] }>;
  /**
   * The duplicate strategy the receipt is actually pinned to, read back from
   * `data_import_jobs.duplicate_strategy` (BACKLOG.md J38).
   *
   * Not the strategy that was requested. `start_data_import_job` reuses an unfinished job for the
   * same (organization, domain, file checksum, creator) and keeps the strategy it was created
   * with, while the processor scores the rows using whatever the request asked for -- so a second
   * dry run under a new strategy looks fine and the apply that follows is refused with
   * "Duplicate strategy cannot change after the import job is created" (409). This column is what
   * apply will be judged against, so it is what the wizard has to show.
   *
   * Null when the job row could not be read back; the wizard then simply does not claim to know.
   */
  pinnedDuplicateStrategy: "create" | "skip" | "update" | null;
}

/** @deprecated Prefer DomainImportResult */
export type EmployeeImportResult = DomainImportResult;

async function runImportChunks(input: {
  domain: ImportDomain;
  csv: string;
  fileName: string;
  strategy: "create" | "skip" | "update";
  mode: "validate" | "apply";
  jobId?: string;
}): Promise<DomainImportResult> {
  if (!canUploadImportDomain(input.domain)) {
    throw new Error(`${input.domain} import is template-only; no active processor is available.`);
  }
  const fn = importProcessorFunction(input.domain);
  if (!fn) throw new Error(`No import processor for domain ${input.domain}`);

  let offset = 0;
  let jobId = input.jobId;
  const aggregate: DomainImportResult = {
    job_id: jobId ?? "",
    totalRows: 0,
    succeeded: 0,
    failed: 0,
    nextOffset: null,
    results: [],
    pinnedDuplicateStrategy: null,
  };
  do {
    const { data, error } = await supabase.functions.invoke<DomainImportResult>(fn, {
      body: {
        csv: input.csv,
        file_name: input.fileName,
        duplicate_strategy: input.strategy,
        mode: input.mode,
        job_id: jobId,
        offset,
        limit: 200,
      },
    });
    if (error) throw error;
    if (!data?.job_id) throw new Error("Import processor did not return a job receipt.");
    jobId = data.job_id;
    aggregate.job_id = data.job_id;
    aggregate.totalRows = data.totalRows;
    aggregate.succeeded += data.succeeded;
    aggregate.failed += data.failed;
    aggregate.results.push(...data.results);
    aggregate.nextOffset = data.nextOffset;
    offset = data.nextOffset ?? 0;
  } while (aggregate.nextOffset !== null);

  // `authenticated` has select on data_import_jobs, so the pin is readable directly. The
  // processor's own response echoes the REQUESTED strategy, which is exactly the value that
  // disagrees with the receipt in the case this exists for.
  const { data: job } = await supabase
    .from("data_import_jobs")
    .select("duplicate_strategy")
    .eq("id", aggregate.job_id)
    .maybeSingle();
  const pinned = job?.duplicate_strategy;
  aggregate.pinnedDuplicateStrategy =
    pinned === "create" || pinned === "skip" || pinned === "update" ? pinned : null;
  return aggregate;
}

export function useRunDomainImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runImportChunks,
    onSuccess: () => client.invalidateQueries({ queryKey: ["data-import-jobs"] }),
  });
}

