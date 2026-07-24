/**
 * Employees routinely accumulate multiple employee_training_records rows for the same
 * training_type_id over time: complete_training_class() and course completion insert a
 * fresh row each renewal cycle rather than updating the prior one, and the nightly
 * recalculation keeps grading each historical row by its own completion_date, so
 * superseded rows stay "expired" forever. Any aggregate that counts raw rows therefore
 * overstates outstanding training. These helpers select the single current record per
 * (employee_id, training_type_id) -- the same ordering used by the matrix pages:
 * latest due_date, then completion_date, then created_at.
 */
export interface CurrentTrainingRecordLike {
  employee_id: string;
  training_type_id: string;
  due_date?: string | null;
  completion_date?: string | null;
  created_at?: string | null;
}

export function isMoreCurrentTrainingRecord(a: CurrentTrainingRecordLike, b: CurrentTrainingRecordLike): boolean {
  const aDue = a.due_date ?? "";
  const bDue = b.due_date ?? "";
  if (aDue !== bDue) return aDue > bDue;
  const aCompletion = a.completion_date ?? "";
  const bCompletion = b.completion_date ?? "";
  if (aCompletion !== bCompletion) return aCompletion > bCompletion;
  return (a.created_at ?? "") > (b.created_at ?? "");
}

/** One current record per (employee_id, training_type_id); superseded history is dropped. */
export function selectCurrentTrainingRecords<T extends CurrentTrainingRecordLike>(records: T[]): T[] {
  const currentByKey = new Map<string, T>();
  for (const record of records) {
    const key = `${record.employee_id}\u0000${record.training_type_id}`;
    const current = currentByKey.get(key);
    if (!current || isMoreCurrentTrainingRecord(record, current)) currentByKey.set(key, record);
  }
  return [...currentByKey.values()];
}
