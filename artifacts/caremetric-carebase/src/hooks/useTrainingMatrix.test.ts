import { describe, expect, it, vi } from "vitest";

// Hook module imports Supabase at module scope; the pure helpers under test do not need a client.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  TRAINING_MATRIX_MAX_PAGE_SIZE,
  TRAINING_MATRIX_QUERY_KEY,
  buildTrainingMatrixArgs,
} from "./useTrainingMatrix";

describe("buildTrainingMatrixArgs", () => {
  it("sends 'all' rather than a filter when nothing is narrowed", () => {
    const args = buildTrainingMatrixArgs({});
    expect(args.p_status_filter).toBe("all");
    expect(args.p_facility_id).toBeUndefined();
    expect(args.p_search).toBeUndefined();
    expect(args.p_due_within_days).toBeUndefined();
    expect(args.p_trainer_only).toBe(false);
    expect(args.p_meds_only).toBe(false);
  });

  it("drops a whitespace-only search instead of matching every row against spaces", () => {
    expect(buildTrainingMatrixArgs({ search: "   " }).p_search).toBeUndefined();
    expect(buildTrainingMatrixArgs({ search: "  ada " }).p_search).toBe("ada");
  });

  it("defaults sorting and paging to the grid's own defaults", () => {
    const args = buildTrainingMatrixArgs({});
    expect(args.p_sort_field).toBe("lastName");
    expect(args.p_sort_dir).toBe("asc");
    expect(args.p_page).toBe(1);
    expect(args.p_page_size).toBe(15);
  });

  it("passes the caller's local day so a due-window does not shift a day west of UTC", () => {
    expect(buildTrainingMatrixArgs({}).p_today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("forwards an explicit due window, including zero (due today)", () => {
    expect(buildTrainingMatrixArgs({ dueWithinDays: 30 }).p_due_within_days).toBe(30);
    // 0 is a real filter, not "unset" -- it must survive the undefined-ing above.
    expect(buildTrainingMatrixArgs({ dueWithinDays: 0 }).p_due_within_days).toBe(0);
  });
});

describe("training matrix cache key", () => {
  it("nests under training_records so existing record invalidations reach the grid", () => {
    // Seven call sites already invalidate ["training_records"] after writing a record
    // (recording a result, completing a class, assigning a course, survey-day fixes...).
    // React Query matches by prefix, so the grid must stay under that key or every one of
    // those would leave a stale matrix on screen.
    expect(TRAINING_MATRIX_QUERY_KEY[0]).toBe("training_records");
  });

  it("keeps the export cap in step with the server clamp", () => {
    expect(TRAINING_MATRIX_MAX_PAGE_SIZE).toBe(500);
  });
});
