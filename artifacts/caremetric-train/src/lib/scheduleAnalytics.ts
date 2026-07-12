export interface ScheduleAnalyticsAssignment {
  employee_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  status: string;
  source: string | null;
  unit_id: string | null;
  employees?: { first_name: string; last_name: string } | null;
}

export interface ScheduleAnalyticsSummary {
  totalShifts: number;
  scheduledHours: number;
  autoFilledShifts: number;
  manualShifts: number;
  exceptionShifts: number;
  unitDayCoverageGaps: number;
  employeesOver40Hours: { employeeId: string; name: string; hours: number }[];
}

function timeToMinutes(time: string): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}

export function shiftDurationHours(startTime: string, endTime: string): number {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return (end - start) / 60;
}

export function summarizeScheduleAnalytics({
  assignments,
  dates,
  unitIds,
}: {
  assignments: ScheduleAnalyticsAssignment[];
  dates: string[];
  unitIds: string[];
}): ScheduleAnalyticsSummary {
  const activeAssignments = assignments.filter((a) => a.status !== "called_off");
  const hoursByEmployee = new Map<string, { name: string; hours: number }>();
  let scheduledHours = 0;
  let autoFilledShifts = 0;
  let manualShifts = 0;
  let exceptionShifts = 0;

  for (const assignment of assignments) {
    const hours = assignment.status === "called_off" ? 0 : shiftDurationHours(assignment.start_time, assignment.end_time);
    scheduledHours += hours;
    if (assignment.source === "auto_fill") autoFilledShifts += 1;
    else manualShifts += 1;
    if (assignment.status === "called_off" || assignment.status === "no_show") exceptionShifts += 1;

    const existing = hoursByEmployee.get(assignment.employee_id) ?? {
      name: assignment.employees ? `${assignment.employees.first_name} ${assignment.employees.last_name}` : "Unknown employee",
      hours: 0,
    };
    existing.hours += hours;
    hoursByEmployee.set(assignment.employee_id, existing);
  }

  const dateSet = new Set(dates);
  const unitSet = new Set(unitIds);
  const coveredUnitDays = new Set(
    activeAssignments
      .filter((a) => a.unit_id && dateSet.has(a.shift_date) && unitSet.has(a.unit_id))
      .map((a) => `${a.unit_id}|${a.shift_date}`),
  );
  const expectedUnitDays = dates.length * unitIds.length;
  const unitDayCoverageGaps = Math.max(0, expectedUnitDays - coveredUnitDays.size);

  return {
    totalShifts: assignments.length,
    scheduledHours: Math.round(scheduledHours * 10) / 10,
    autoFilledShifts,
    manualShifts,
    exceptionShifts,
    unitDayCoverageGaps,
    employeesOver40Hours: [...hoursByEmployee.entries()]
      .filter(([, row]) => row.hours > 40)
      .map(([employeeId, row]) => ({ employeeId, name: row.name, hours: Math.round(row.hours * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours),
  };
}
