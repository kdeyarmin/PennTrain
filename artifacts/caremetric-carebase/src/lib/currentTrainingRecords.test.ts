import { describe, expect, it } from "vitest";
import { selectCurrentTrainingRecords } from "./currentTrainingRecords";

describe("selectCurrentTrainingRecords", () => {
  it("keeps only the latest record per employee and training type", () => {
    const records = [
      { employee_id: "e1", training_type_id: "t1", due_date: "2025-07-01", completion_date: "2024-07-01", status: "expired" },
      { employee_id: "e1", training_type_id: "t1", due_date: "2026-09-01", completion_date: "2025-09-01", status: "compliant" },
      { employee_id: "e1", training_type_id: "t2", due_date: "2026-01-01", completion_date: "2025-01-01", status: "expired" },
      { employee_id: "e2", training_type_id: "t1", due_date: "2026-09-01", completion_date: "2025-09-01", status: "compliant" },
    ];

    const current = selectCurrentTrainingRecords(records);

    expect(current).toHaveLength(3);
    expect(current.filter((record) => record.status === "expired")).toHaveLength(1);
    expect(
      current.find((record) => record.employee_id === "e1" && record.training_type_id === "t1")?.due_date,
    ).toBe("2026-09-01");
  });

  it("breaks due-date ties by completion date, then created_at", () => {
    const records = [
      { employee_id: "e1", training_type_id: "t1", due_date: null, completion_date: "2025-01-01", created_at: "2025-01-01T00:00:00Z" },
      { employee_id: "e1", training_type_id: "t1", due_date: null, completion_date: "2025-06-01", created_at: "2025-06-01T00:00:00Z" },
    ];

    expect(selectCurrentTrainingRecords(records)).toEqual([records[1]]);
  });
});
