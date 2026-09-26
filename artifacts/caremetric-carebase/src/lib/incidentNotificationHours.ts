/**
 * The deadline a manually added incident notification starts from, by notification type. These
 * are the windows the `incident_notification_rules` presets give the same types (20260925110100):
 * the Department report is 24 hours (2600.16(c) / 2800.16(c)); the OAPSA oral report to protective
 * services and the police call are "immediately" (6 Pa. Code 15.151(a)(1)), for which two hours is
 * this product's ceiling; the written report is 48. Types no preset covers keep 24. The manager can
 * still change the number -- this only keeps a protective-services entry from quietly taking the
 * Department's 24 hours.
 */
export const INCIDENT_NOTIFICATION_DEFAULT_HOURS = {
  state_hotline: 24,
  licensing_agency: 24,
  protective_services: 2,
  law_enforcement: 2,
  written_report: 48,
  family_guardian: 24,
  resident: 0,
  resident_family: 0,
  designated_person: 0,
  prescriber: 0,
  supervision_plan: 0,
  // The server preset uses the end of the facility business day. A manually added
  // duty defaults to immediate so it cannot invent a rolling 24-hour extension.
  department_of_aging: 0,
  other: 24,
} as const satisfies Record<string, number>;

export type IncidentNotificationType = keyof typeof INCIDENT_NOTIFICATION_DEFAULT_HOURS;

export function defaultNotificationHours(notificationType: IncidentNotificationType): number {
  return INCIDENT_NOTIFICATION_DEFAULT_HOURS[notificationType];
}

/** Hours from the input, or the type's default when it is blank or not a positive number. */
export function notificationDueHours(notificationType: IncidentNotificationType, enteredHours: string): number {
  const hours = Number(enteredHours);
  return enteredHours.trim() !== "" && Number.isFinite(hours) && hours >= 0 ? hours : defaultNotificationHours(notificationType);
}
