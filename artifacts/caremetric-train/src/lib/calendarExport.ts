export interface TrainingClassCalendarEvent {
  id: string;
  className: string;
  classDate: string;
  durationHours: number | null;
  trainingTypeName?: string;
  facilityName?: string;
  location?: string | null;
  status?: string | null;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function dateToIcsDate(date: string): string {
  return date.replace(/-/g, "");
}

function addOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildTrainingClassesIcs(events: TrainingClassCalendarEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CareMetric Train//Training Classes//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const event of events) {
    const description = [
      event.trainingTypeName ? `Training type: ${event.trainingTypeName}` : null,
      event.durationHours ? `Duration: ${event.durationHours} hour${event.durationHours === 1 ? "" : "s"}` : null,
      event.status ? `Status: ${event.status}` : null,
    ].filter(Boolean).join("\\n");
    const location = event.location || event.facilityName || "";

    lines.push(
      "BEGIN:VEVENT",
      `UID:training-class-${event.id}@caremetric-train`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateToIcsDate(event.classDate)}`,
      `DTEND;VALUE=DATE:${dateToIcsDate(addOneDay(event.classDate))}`,
      `SUMMARY:${escapeIcsText(event.className)}`,
    );
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
