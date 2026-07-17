export interface CustomerValueBaselineForm {
  hourlyCost: string;
  softwareCost: string;
  reportMinutes: string;
  inspectionMinutes: string;
  courseMinutes: string;
  workItemMinutes: string;
  portalMinutes: string;
  replacedSystems: string;
}

export interface CustomerValueBaselineSaveInput {
  hourlyAdminCost: number;
  annualSoftwareCost: number;
  reportExportMinutes: number;
  mockInspectionMinutes: number;
  courseCompletionMinutes: number;
  closedWorkItemMinutes: number;
  portalMessageMinutes: number;
  replacedSystems: string[];
  note: string;
}

interface CustomerValueBaselineSource {
  configured: boolean;
  hourlyAdminCost?: number;
  retiredSoftwareMonthlyCost?: number;
  retiredTools?: string[];
  assumptions?: Record<string, number>;
}

export const DEFAULT_CUSTOMER_VALUE_BASELINE: CustomerValueBaselineForm = {
  hourlyCost: "32",
  softwareCost: "12000",
  reportMinutes: "45",
  inspectionMinutes: "240",
  courseMinutes: "15",
  workItemMinutes: "10",
  portalMinutes: "5",
  replacedSystems: "compliance spreadsheets, paper binders, reminder calendars, standalone training tracker",
};

const numericLimits: Record<keyof Omit<CustomerValueBaselineForm, "replacedSystems">, number> = {
  hourlyCost: 10_000,
  softwareCost: 120_000_000,
  reportMinutes: 10_080,
  inspectionMinutes: 10_080,
  courseMinutes: 10_080,
  workItemMinutes: 10_080,
  portalMinutes: 10_080,
};

function numberInput(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return String(Math.round(parsed * 100) / 100);
}

export function customerValueDashboardToForm(source: CustomerValueBaselineSource): CustomerValueBaselineForm {
  if (!source.configured) return { ...DEFAULT_CUSTOMER_VALUE_BASELINE };

  const assumptions = source.assumptions ?? {};
  return {
    hourlyCost: numberInput(source.hourlyAdminCost),
    softwareCost: numberInput(Number(source.retiredSoftwareMonthlyCost ?? 0) * 12),
    reportMinutes: numberInput(assumptions.report_export_minutes),
    inspectionMinutes: numberInput(assumptions.mock_inspection_minutes),
    courseMinutes: numberInput(assumptions.course_completion_admin_minutes),
    workItemMinutes: numberInput(assumptions.closed_work_item_minutes),
    portalMinutes: numberInput(assumptions.portal_message_minutes),
    replacedSystems: (source.retiredTools ?? []).join(", "),
  };
}

export function customerValueBaselineToInput(form: CustomerValueBaselineForm): CustomerValueBaselineSaveInput {
  return {
    hourlyAdminCost: Number(form.hourlyCost),
    annualSoftwareCost: Number(form.softwareCost),
    reportExportMinutes: Number(form.reportMinutes),
    mockInspectionMinutes: Number(form.inspectionMinutes),
    courseCompletionMinutes: Number(form.courseMinutes),
    closedWorkItemMinutes: Number(form.workItemMinutes),
    portalMessageMinutes: Number(form.portalMinutes),
    replacedSystems: form.replacedSystems.split(",").map((item) => item.trim()).filter(Boolean),
    note: "Customer-confirmed Value Center baseline",
  };
}

export function isCustomerValueBaselineValid(form: CustomerValueBaselineForm) {
  const numericValuesAreValid = Object.entries(numericLimits).every(([rawField, maximum]) => {
    const field = rawField as keyof typeof numericLimits;
    const value = Number(form[field]);
    return form[field].trim() !== "" && Number.isFinite(value) && value >= 0 && value <= maximum;
  });
  const replacedSystems = customerValueBaselineToInput(form).replacedSystems;
  return numericValuesAreValid
    && replacedSystems.length <= 20
    && replacedSystems.every((item) => item.length <= 120);
}

export function customerValueBaselinesMatch(left: CustomerValueBaselineForm, right: CustomerValueBaselineForm) {
  return JSON.stringify(customerValueBaselineToInput(left)) === JSON.stringify(customerValueBaselineToInput(right));
}
