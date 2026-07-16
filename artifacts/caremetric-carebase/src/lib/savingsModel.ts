export interface SavingsInputs {
  weeklyCoordinationHours: number;
  annualBinderHours: number;
  loadedHourlyRate: number;
  monthlyReplaceableToolSpend: number;
  expectedLaborReductionPercent: number;
  annualCareBasePrice: number;
}

export interface SavingsResult {
  annualCoordinationHours: number;
  annualLaborCost: number;
  annualReplaceableToolSpend: number;
  currentAddressableCost: number;
  modeledLaborOpportunity: number;
  grossAnnualOpportunity: number;
  netAnnualOpportunity: number | null;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateSavingsModel(inputs: SavingsInputs): SavingsResult {
  const weeklyCoordinationHours = nonNegative(inputs.weeklyCoordinationHours);
  const annualBinderHours = nonNegative(inputs.annualBinderHours);
  const loadedHourlyRate = nonNegative(inputs.loadedHourlyRate);
  const monthlyReplaceableToolSpend = nonNegative(inputs.monthlyReplaceableToolSpend);
  const expectedLaborReductionPercent = Math.min(
    100,
    nonNegative(inputs.expectedLaborReductionPercent),
  );
  const annualCareBasePrice = nonNegative(inputs.annualCareBasePrice);

  const annualCoordinationHours = weeklyCoordinationHours * 52 + annualBinderHours;
  const annualLaborCost = annualCoordinationHours * loadedHourlyRate;
  const annualReplaceableToolSpend = monthlyReplaceableToolSpend * 12;
  const currentAddressableCost = annualLaborCost + annualReplaceableToolSpend;
  const modeledLaborOpportunity = annualLaborCost * (expectedLaborReductionPercent / 100);
  const grossAnnualOpportunity = modeledLaborOpportunity + annualReplaceableToolSpend;

  return {
    annualCoordinationHours,
    annualLaborCost,
    annualReplaceableToolSpend,
    currentAddressableCost,
    modeledLaborOpportunity,
    grossAnnualOpportunity,
    netAnnualOpportunity:
      annualCareBasePrice > 0 ? grossAnnualOpportunity - annualCareBasePrice : null,
  };
}
