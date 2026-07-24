export interface SpecialCareUnitLike {
  id: string;
  name: string;
  is_active?: boolean | null;
}

export interface SpecialCareResidentLike {
  id: string;
  sdcu?: boolean | null;
  status?: string | null;
}

export interface SpecialCarePreferenceLike {
  employee_id: string;
  unit_id?: string | null;
}

export interface SpecialCareTrainingRecordLike {
  employee_id: string;
  training_type_id: string;
  status?: string | null;
}

export interface SpecialCareTrainingTypeLike {
  id: string;
  name?: string | null;
  code?: string | null;
}

export interface SpecialCareComplianceSummary {
  designatedUnits: SpecialCareUnitLike[];
  residentPlacements: number;
  assignedStaffCount: number;
  trainedStaffCount: number;
  staffingGapCount: number;
  trainingTypeIds: string[];
  status: "inspection_ready" | "needs_attention" | "not_applicable";
}

const DESIGNATION_PATTERN = /(memory|dementia|special care|sdcu|secured)/i;
const TRAINING_PATTERN = /(dementia|memory|special care|cognitive|alzheimer)/i;
const CURRENT_STATUSES = new Set(["compliant", "due_soon"]);

export function isSpecialCareUnit(unit: Pick<SpecialCareUnitLike, "name">) {
  return DESIGNATION_PATTERN.test(unit.name);
}

export function findSpecialCareTrainingTypeIds(trainingTypes: SpecialCareTrainingTypeLike[]) {
  return trainingTypes
    .filter((type) => TRAINING_PATTERN.test(`${type.name ?? ""} ${type.code ?? ""}`))
    .map((type) => type.id);
}

export function buildSpecialCareComplianceSummary({
  units,
  residents,
  schedulePreferences,
  trainingRecords,
  trainingTypes,
}: {
  units: SpecialCareUnitLike[];
  residents: SpecialCareResidentLike[];
  schedulePreferences: SpecialCarePreferenceLike[];
  trainingRecords: SpecialCareTrainingRecordLike[];
  trainingTypes: SpecialCareTrainingTypeLike[];
}): SpecialCareComplianceSummary {
  const designatedUnits = units.filter((unit) => unit.is_active !== false && isSpecialCareUnit(unit));
  const designatedUnitIds = new Set(designatedUnits.map((unit) => unit.id));
  const residentPlacements = residents.filter((resident) => resident.status !== "discharged" && Boolean(resident.sdcu)).length;
  const trainingTypeIds = findSpecialCareTrainingTypeIds(trainingTypes);
  const assignedStaff = new Set(
    schedulePreferences
      .filter((preference) => preference.unit_id && designatedUnitIds.has(preference.unit_id))
      .map((preference) => preference.employee_id),
  );
  const trainedStaff = new Set(
    trainingRecords
      .filter((record) => assignedStaff.has(record.employee_id))
      .filter((record) => trainingTypeIds.includes(record.training_type_id))
      .filter((record) => CURRENT_STATUSES.has(record.status ?? ""))
      .map((record) => record.employee_id),
  );
  const staffingGapCount = Array.from(assignedStaff).filter((employeeId) => !trainedStaff.has(employeeId)).length;
  const applicable = designatedUnits.length > 0 || residentPlacements > 0;
  // A unit housing SDCU residents with nobody assigned to it has no staffing
  // "gaps" to count, but it is certainly not inspection-ready.
  const staffed = residentPlacements === 0 || assignedStaff.size > 0;

  return {
    designatedUnits,
    residentPlacements,
    assignedStaffCount: assignedStaff.size,
    trainedStaffCount: trainedStaff.size,
    staffingGapCount,
    trainingTypeIds,
    status: !applicable ? "not_applicable" : staffed && staffingGapCount === 0 && trainingTypeIds.length > 0 ? "inspection_ready" : "needs_attention",
  };
}
