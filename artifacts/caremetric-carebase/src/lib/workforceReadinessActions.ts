export interface WorkforceImpactProjection {
  activeEmployees: number;
  currentBlockers: number;
  employeesAtRisk30: number;
  employeesAtRisk60: number;
  employeesAtRisk90: number;
  /** Share of active workforce currently blocked from duty. */
  currentCoverageImpactPct: number;
  /** Share of active workforce with a risk inside 30 days (includes current blockers). */
  nearTermCoverageImpactPct: number;
  /** Share of active workforce with a risk inside 90 days. */
  quarterCoverageImpactPct: number;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((Math.min(numerator, denominator) / denominator) * 1000) / 10;
}

export function projectWorkforceImpact(input: {
  activeEmployees: number;
  currentBlockers: number;
  horizons: Array<{ days: number; employeesAtRisk: number }>;
}): WorkforceImpactProjection {
  const byDays = (days: number) =>
    input.horizons.find((horizon) => horizon.days === days)?.employeesAtRisk ?? 0;
  const employeesAtRisk30 = byDays(30);
  const employeesAtRisk60 = byDays(60);
  const employeesAtRisk90 = byDays(90);
  return {
    activeEmployees: input.activeEmployees,
    currentBlockers: input.currentBlockers,
    employeesAtRisk30,
    employeesAtRisk60,
    employeesAtRisk90,
    currentCoverageImpactPct: pct(input.currentBlockers, input.activeEmployees),
    nearTermCoverageImpactPct: pct(employeesAtRisk30, input.activeEmployees),
    quarterCoverageImpactPct: pct(employeesAtRisk90, input.activeEmployees),
  };
}

export function remediationActionForReason(type: string): {
  label: string;
  description: string;
} {
  switch (type) {
    case "credential":
      return {
        label: "Renew credential",
        description: "Open the credential record, attach evidence, and complete the governed renewal.",
      };
    case "training":
      return {
        label: "Assign training",
        description: "Create or complete the required course assignment before eligibility lapses.",
      };
    case "duty_clearance":
      return {
        label: "Restore duty clearance",
        description: "Resolve the clearance restriction and re-check unsupervised duty eligibility.",
      };
    default:
      return {
        label: "Open source record",
        description: "Review the forecasted source and restore workforce eligibility.",
      };
  }
}
