import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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
        .range(from, to);
      if (filters.domain && filters.domain !== "all") query = query.eq("domain", filters.domain);
      if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
      if (filters.search?.trim()) {
        const term = filters.search.trim().replaceAll(",", " ");
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
      const rpc = action === "finalize" ? "finalize_data_import_job" : "rollback_employee_import_job";
      const { data, error } = await supabase.rpc(rpc, { p_job_id: jobId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["data-import-jobs"] }),
  });
}

export interface EmployeeImportResult {
  job_id: string;
  totalRows: number;
  succeeded: number;
  failed: number;
  nextOffset: number | null;
  results: Array<{ row: number; success: boolean; action?: string; error?: string; warnings?: string[] }>;
}

export function useRunEmployeeImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { csv: string; fileName: string; strategy: "create" | "skip" | "update"; mode: "validate" | "apply"; jobId?: string }) => {
      let offset = 0;
      let jobId = input.jobId;
      const aggregate: EmployeeImportResult = { job_id: jobId ?? "", totalRows: 0, succeeded: 0, failed: 0, nextOffset: null, results: [] };
      do {
        const { data, error } = await supabase.functions.invoke<EmployeeImportResult>("bulk-import-employees", { body: {
          csv: input.csv, file_name: input.fileName, duplicate_strategy: input.strategy,
          mode: input.mode, job_id: jobId, offset, limit: 200,
        } });
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
      return aggregate;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["data-import-jobs"] }),
  });
}
