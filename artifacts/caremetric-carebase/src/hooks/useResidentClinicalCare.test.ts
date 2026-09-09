import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ rpc: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: harness.rpc } }));
vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: harness.invalidateQueries }),
}));

import { useSaveClinicalProgressNote, useSignClinicalProgressNote } from "./useResidentClinicalCare";
import { useResidentClinicalChartSummary } from "./useClinicalObservations";

type Mutation = {
  mutationFn: (input: Record<string, unknown>) => Promise<unknown>;
  onSuccess: (data: unknown, input: Record<string, unknown>) => Promise<unknown>;
};

beforeEach(() => {
  harness.rpc.mockReset().mockResolvedValue({ data: "note-1", error: null });
  harness.invalidateQueries.mockReset().mockResolvedValue(undefined);
});

describe("clinical draft persistence", () => {
  it("sends the existing id and clinical links when editing a draft", async () => {
    const mutation = useSaveClinicalProgressNote() as unknown as Mutation;
    await mutation.mutationFn({
      residentId: "resident-1", noteId: "note-1", noteType: "nursing", body: "Reviewed note",
      authoredAt: "2026-09-07T12:00:00Z", carePlanId: "plan-1", changeEventId: "event-1",
    });
    expect(harness.rpc).toHaveBeenCalledWith("save_clinical_progress_note", {
      p_resident_id: "resident-1", p_note_id: "note-1", p_note_type: "nursing", p_body: "Reviewed note",
      p_authored_at: "2026-09-07T12:00:00Z", p_care_plan_id: "plan-1", p_change_event_id: "event-1",
    });
  });

  it.each([useSaveClinicalProgressNote, useSignClinicalProgressNote])("refreshes the list and the exact chart-summary prefix after a note change", async (hook) => {
    const query = useResidentClinicalChartSummary("resident-1", "Caregiver clinical charting") as unknown as { queryKey: unknown[] };
    const mutation = hook() as unknown as Mutation;
    await mutation.onSuccess("note-1", { residentId: "resident-1", noteId: "note-1" });
    expect(query.queryKey).toEqual(["clinical-chart-summary", "resident-1", "Caregiver clinical charting"]);
    expect(harness.invalidateQueries).toHaveBeenCalledWith({ queryKey: query.queryKey.slice(0, 2) });
    expect(harness.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["resident-clinical-care", "resident-1"] });
  });
});
