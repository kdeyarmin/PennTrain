/**
 * Acuity-aware advisory workload (program plan Phase 8b, request item 19).
 *
 * ADVISORY. NEVER A STAFFING MANDATE. This module deliberately does not, and must not, emit a
 * required staff count. It emits *care minutes* attributable to named, itemized factors, and it
 * emits observations a scheduler should look at. What that means for a rota is a judgement a person
 * makes with knowledge this program does not have -- the building, who is working, what else is
 * happening today. A product that prints "you need 4.2 staff" gets that number quoted back to a
 * facility in a survey, and it will be wrong.
 *
 * NOT A BLACK BOX EITHER. The program-wide constraint against opaque scores applies here as much as
 * it does to resident risk. Every minute in the total is traceable: each factor is a named constant,
 * each contribution is returned with its own label, count and subtotal, and the totals are the sum
 * of the parts and nothing else. There is no weighting anybody cannot read, no learned coefficient,
 * and no calibration step.
 *
 * WHY THE ARITHMETIC IS HERE RATHER THAN IN SQL. The exit gate requires the output be reproducible
 * from a fixture roster. Pure functions over a plain input object are reproducible by construction
 * and testable without a database; the read path's job is only to hand over the roster.
 *
 * THE MINUTE FIGURES ARE A STARTING POINT, NOT A STANDARD. They are exported so a facility can argue
 * with them, and no PA regulation prescribes them. Anyone quoting them as a regulatory requirement
 * is misusing this output, which is why every surface renders the disclaimer alongside.
 */

/** Care minutes per resident per shift, by how much physical help they need. */
export const LEVEL_OF_CARE_MINUTES: Record<string, number> = {
  not_assessed: 20,
  independent: 5,
  prompting_cueing: 15,
  some_physical_assistance: 35,
  total_physical_assistance: 60,
};

/** Additional minutes for transfers, which are the most staff-intensive routine task. */
export const TRANSFER_MINUTES: Record<string, number> = {
  not_assessed: 5,
  independent: 0,
  supervision: 5,
  one_person: 15,
  two_person: 30,
  mechanical_lift: 40,
};

/** Additional minutes for mobility support and the supervision it implies. */
export const AMBULATION_MINUTES: Record<string, number> = {
  not_assessed: 0,
  independent: 0,
  cane: 5,
  walker: 10,
  rollator: 10,
  wheelchair: 20,
  bedfast: 30,
};

/** Additional minutes for the checks a fall risk implies. */
export const FALL_RISK_MINUTES: Record<string, number> = {
  not_assessed: 0, low: 0, moderate: 10, high: 20,
};

/** Additional minutes for elopement monitoring. */
export const ELOPEMENT_MINUTES: Record<string, number> = {
  not_assessed: 0, none: 0, monitored: 10, high: 25,
};

/** Additional minutes for cueing, redirection and behavioural support. */
export const COGNITIVE_MINUTES: Record<string, number> = {
  not_assessed: 0,
  no_impairment: 0,
  mild_impairment: 10,
  moderate_impairment: 20,
  severe_impairment: 35,
};

/** Minutes per scheduled service task, appointment escort, and recent admission or return. */
export const EVENT_MINUTES = {
  scheduledServiceTask: 12,
  appointmentEscort: 45,
  recentAdmission: 60,
  hospitalReturn: 45,
} as const;

/** A resident is "recently" admitted or returned within this many days. */
export const SETTLING_IN_DAYS = 3;

export interface AcuityResidentLike {
  id: string;
  display_name: string;
  status: string;
  level_of_care: string;
  transfer_assistance: string;
  ambulation_status: string;
  fall_risk: string;
  elopement_risk: string;
  cognitive_status: string;
  /** ISO date, or null. */
  admission_date: string | null;
  /** ISO timestamp of the most recent hospital return, or null. */
  last_hospital_return_at: string | null;
  scheduled_service_tasks: number;
  appointment_escorts: number;
}

export interface AcuityStaffLike {
  employee_id: string;
  display_name: string;
  qualification_keys: string[];
}

export interface AcuityShiftLike {
  key: string;
  label: string;
  unit_name: string | null;
  staff: AcuityStaffLike[];
  /** Qualification keys this shift requires at least one of each of. */
  required_qualification_keys: string[];
  /** Services that must happen on this shift and the qualification each needs. */
  critical_services: { name: string; required_qualification_key: string | null }[];
}

export interface WorkloadContribution {
  key: string;
  label: string;
  /** How many residents or events this covers. */
  count: number;
  minutes: number;
}

export interface AcuityObservation {
  key: string;
  severity: "attention" | "note";
  message: string;
  /** Residents or staff the observation is about, so it opens its records like every other figure. */
  subjectIds: string[];
}

export interface ShiftWorkload {
  key: string;
  label: string;
  unitName: string | null;
  /** Itemized, and summing to `totalMinutes` exactly. */
  contributions: WorkloadContribution[];
  totalMinutes: number;
  residentCount: number;
  staffCount: number;
  /** Care minutes divided by staff on the shift, or null with nobody scheduled. */
  minutesPerStaff: number | null;
  observations: AcuityObservation[];
}

export interface AcuityWorkloadInput {
  residents: AcuityResidentLike[];
  shifts: AcuityShiftLike[];
  /** Reference date for "recently admitted" and "recently returned". */
  asOf?: Date;
}

function daysBetween(from: string | null, to: Date): number | null {
  if (!from) return null;
  const parsed = Date.parse(from);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((to.getTime() - parsed) / 86_400_000);
}

function contribution(
  key: string,
  label: string,
  residents: AcuityResidentLike[],
  minutesFor: (resident: AcuityResidentLike) => number,
): WorkloadContribution {
  let count = 0;
  let minutes = 0;
  for (const resident of residents) {
    const value = minutesFor(resident);
    if (value > 0) {
      count += 1;
      minutes += value;
    }
  }
  return { key, label, count, minutes };
}

/** Residents needing two staff for a transfer — the single most useful line for a scheduler. */
export function residentsRequiringTwoStaff(residents: AcuityResidentLike[]): AcuityResidentLike[] {
  return residents.filter(
    (resident) => resident.transfer_assistance === "two_person"
      || resident.transfer_assistance === "mechanical_lift",
  );
}

function observationsFor(
  residents: AcuityResidentLike[],
  shift: AcuityShiftLike,
  asOf: Date,
): AcuityObservation[] {
  const observations: AcuityObservation[] = [];

  const twoStaff = residentsRequiringTwoStaff(residents);
  if (twoStaff.length > 0 && shift.staff.length < 2) {
    observations.push({
      key: "two_person_transfer_without_two_staff",
      severity: "attention",
      message: `${twoStaff.length} resident${twoStaff.length === 1 ? "" : "s"} need two staff for transfers, and fewer than two are scheduled.`,
      subjectIds: twoStaff.map((resident) => resident.id),
    });
  }

  const held = new Set(shift.staff.flatMap((member) => member.qualification_keys));
  const missing = shift.required_qualification_keys.filter((key) => !held.has(key));
  if (missing.length > 0) {
    observations.push({
      key: "qualification_gap",
      severity: "attention",
      message: `No one scheduled holds: ${missing.join(", ")}.`,
      subjectIds: [],
    });
  }

  for (const service of shift.critical_services) {
    if (service.required_qualification_key && !held.has(service.required_qualification_key)) {
      observations.push({
        key: "uncovered_critical_service",
        severity: "attention",
        message: `${service.name} needs ${service.required_qualification_key}, which nobody scheduled holds.`,
        subjectIds: [],
      });
    }
  }

  const settling = residents.filter((resident) => {
    const sinceAdmission = daysBetween(resident.admission_date, asOf);
    const sinceReturn = daysBetween(resident.last_hospital_return_at, asOf);
    return (sinceAdmission !== null && sinceAdmission >= 0 && sinceAdmission <= SETTLING_IN_DAYS)
      || (sinceReturn !== null && sinceReturn >= 0 && sinceReturn <= SETTLING_IN_DAYS);
  });
  if (settling.length > 0) {
    observations.push({
      key: "recent_admissions_or_returns",
      severity: "note",
      message: `${settling.length} resident${settling.length === 1 ? " has" : "s have"} been admitted or returned from hospital within ${SETTLING_IN_DAYS} days.`,
      subjectIds: settling.map((resident) => resident.id),
    });
  }

  const unassessed = residents.filter((resident) =>
    resident.level_of_care === "not_assessed" || resident.transfer_assistance === "not_assessed");
  if (unassessed.length > 0) {
    observations.push({
      key: "acuity_not_assessed",
      severity: "note",
      message: `${unassessed.length} resident${unassessed.length === 1 ? " has" : "s have"} unrecorded care levels, so this estimate is working from a default for them.`,
      subjectIds: unassessed.map((resident) => resident.id),
    });
  }

  if (shift.staff.length === 0 && residents.length > 0) {
    observations.push({
      key: "no_staff_scheduled",
      severity: "attention",
      message: "Nobody is scheduled for this shift.",
      subjectIds: [],
    });
  }

  return observations;
}

export function buildAcuityWorkload(input: AcuityWorkloadInput): ShiftWorkload[] {
  const asOf = input.asOf ?? new Date();
  const residents = input.residents.filter((resident) => resident.status === "active");

  return input.shifts.map((shift) => {
    const contributions: WorkloadContribution[] = [
      contribution("level_of_care", "Personal care", residents,
        (r) => LEVEL_OF_CARE_MINUTES[r.level_of_care] ?? LEVEL_OF_CARE_MINUTES.not_assessed),
      contribution("transfers", "Transfers", residents,
        (r) => TRANSFER_MINUTES[r.transfer_assistance] ?? TRANSFER_MINUTES.not_assessed),
      contribution("mobility", "Mobility support", residents,
        (r) => AMBULATION_MINUTES[r.ambulation_status] ?? 0),
      contribution("fall_risk", "Fall-risk checks", residents,
        (r) => FALL_RISK_MINUTES[r.fall_risk] ?? 0),
      contribution("elopement", "Elopement monitoring", residents,
        (r) => ELOPEMENT_MINUTES[r.elopement_risk] ?? 0),
      contribution("behavioral", "Cueing and behavioural support", residents,
        (r) => COGNITIVE_MINUTES[r.cognitive_status] ?? 0),
      contribution("scheduled_services", "Scheduled services", residents,
        (r) => Math.max(0, r.scheduled_service_tasks) * EVENT_MINUTES.scheduledServiceTask),
      contribution("appointments", "Appointment escorts", residents,
        (r) => Math.max(0, r.appointment_escorts) * EVENT_MINUTES.appointmentEscort),
      contribution("recent_admissions", "Recent admissions", residents, (r) => {
        const days = daysBetween(r.admission_date, asOf);
        return days !== null && days >= 0 && days <= SETTLING_IN_DAYS ? EVENT_MINUTES.recentAdmission : 0;
      }),
      contribution("hospital_returns", "Hospital returns", residents, (r) => {
        const days = daysBetween(r.last_hospital_return_at, asOf);
        return days !== null && days >= 0 && days <= SETTLING_IN_DAYS ? EVENT_MINUTES.hospitalReturn : 0;
      }),
    ].filter((entry) => entry.minutes > 0);

    const totalMinutes = contributions.reduce((sum, entry) => sum + entry.minutes, 0);

    return {
      key: shift.key,
      label: shift.label,
      unitName: shift.unit_name,
      contributions,
      totalMinutes,
      residentCount: residents.length,
      staffCount: shift.staff.length,
      // Care minutes per scheduled person. NOT a required staffing level, and never presented as
      // one: it is the same total divided a different way, so a scheduler can compare shifts.
      minutesPerStaff: shift.staff.length === 0
        ? null
        : Math.round(totalMinutes / shift.staff.length),
      observations: observationsFor(residents, shift, asOf),
    };
  });
}

/** The sentence every surface showing this output must carry. */
export const ADVISORY_NOTICE =
  "Advisory only. These are estimated care minutes from recorded resident attributes, not a required "
  + "staffing level, and no Pennsylvania regulation prescribes them.";

/**
 * Shifts worth a scheduler's attention, in order. Ordered by whether anything needs attention rather
 * than by workload: the busiest shift is not necessarily the one with a problem.
 */
export function shiftsNeedingAttention(workloads: ShiftWorkload[]): ShiftWorkload[] {
  return workloads
    .filter((shift) => shift.observations.some((entry) => entry.severity === "attention"))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}
