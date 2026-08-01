import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { facilityToday } from "@/lib/dateUtils";
import type { Employee } from "@/hooks/useEmployees";

export interface TrainingMatrixCell {
  trainingTypeId: string;
  trainingRecordId: string | null;
  status: string;
  completionDate: string | null;
  dueDate: string | null;
  trainerName: string | null;
  hours: number | null;
}

export interface TrainingMatrixRow {
  employee: Employee;
  cells: TrainingMatrixCell[];
}

export interface TrainingMatrixTrainingType {
  id: string;
  code: string;
  name: string;
  applies_to_facility_type: string;
  sort_order: number;
}

export interface TrainingMatrixPage {
  trainingTypes: TrainingMatrixTrainingType[];
  rows: TrainingMatrixRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  /** Keyed by training_type_id, computed over the whole filtered set rather than the page. */
  summary: Record<string, { compliant: number; total: number }>;
}

export interface TrainingMatrixFilters {
  /** Undefined means "every facility the caller may read". */
  facilityId?: string;
  search?: string;
  statusFilter?: "all" | "compliant" | "due_soon" | "expired" | "missing";
  trainerOnly?: boolean;
  medsOnly?: boolean;
  /** Undefined means no due-date window filter. */
  dueWithinDays?: number;
  sortField?: "lastName" | "firstName" | "jobTitle";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/**
 * The server caps a page at 500 rows (matching the compliance binder's MAX_LISTED_ROWS),
 * so a CSV export of a filter matching more than this is truncated. TrainingMatrix warns
 * the user when that happens rather than handing over a silently short export.
 */
export const TRAINING_MATRIX_MAX_PAGE_SIZE = 500;

/** See useTrainingMatrixPage for why this sits under the training_records key. */
export const TRAINING_MATRIX_QUERY_KEY = ["training_records", "matrix"] as const;

export function buildTrainingMatrixArgs(filters: TrainingMatrixFilters) {
  return {
    p_facility_id: filters.facilityId,
    p_search: filters.search?.trim() || undefined,
    p_status_filter: filters.statusFilter ?? "all",
    p_trainer_only: filters.trainerOnly ?? false,
    p_meds_only: filters.medsOnly ?? false,
    p_due_within_days: filters.dueWithinDays,
    p_sort_field: filters.sortField ?? "lastName",
    p_sort_dir: filters.sortDir ?? "asc",
    p_page: filters.page ?? 1,
    p_page_size: filters.pageSize ?? 15,
    // The caller's local day, so a "due within 30 days" window doesn't shift by one for
    // facilities west of UTC. Mirrors how the page compared dates when it filtered in JS.
    p_today: facilityToday(),
  };
}

async function fetchTrainingMatrixPage(filters: TrainingMatrixFilters): Promise<TrainingMatrixPage> {
  const { data, error } = await supabase.rpc("get_training_matrix_page", buildTrainingMatrixArgs(filters));
  if (error) throw error;
  return data as unknown as TrainingMatrixPage;
}

/**
 * One page of the training matrix. Filtering, sorting, paging, and the per-training-type
 * compliance summary all happen in the database -- the page previously pulled the whole
 * active roster and every training record joining it just to render fifteen rows.
 */
export function useTrainingMatrixPage(filters: TrainingMatrixFilters) {
  return useQuery({
    // Deliberately nested under "training_records": every existing
    // invalidateQueries({ queryKey: ["training_records"] }) -- recording a result here,
    // completing a class, assigning a course, a survey-day fix -- already invalidates by
    // prefix, so the grid refreshes without each of those call sites having to learn about
    // a new key. TRAINING_MATRIX_QUERY_KEY targets it on its own for roster changes.
    queryKey: [...TRAINING_MATRIX_QUERY_KEY, filters],
    queryFn: () => fetchTrainingMatrixPage(filters),
    // Paging shouldn't blank the grid between pages.
    placeholderData: (previous) => previous,
  });
}

/**
 * Every row matching the current filters, for CSV export. Not a hook: the export runs on
 * click, and keeping this out of the cache avoids holding a 500-row page in memory for a
 * download the user may never repeat.
 */
export function fetchTrainingMatrixExport(filters: TrainingMatrixFilters) {
  return fetchTrainingMatrixPage({ ...filters, page: 1, pageSize: TRAINING_MATRIX_MAX_PAGE_SIZE });
}
