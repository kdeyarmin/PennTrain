/** Manager workspace section names shared by the sidebar and organization settings. */
export const TAILORABLE_NAVIGATION_SECTIONS = [
  { title: "People", description: "Facilities, employees, schedules and invitations" },
  { title: "Training", description: "Courses, assignments, classes and learning plans" },
  { title: "Credentials", description: "Clearances, competencies and qualifications" },
  { title: "Residents & care", description: "Resident records, services and care operations" },
  { title: "Safety & survey", description: "Events, risks, inspections and reports" },
  { title: "Advanced", description: "Compliance tools, policies and document libraries" },
] as const;

// Older preferences used the previous sidebar taxonomy. Normalize at the read boundary so
// those organizations do not have to save settings again before their choices take effect.
// Consolidated sections intentionally have one switch; showing it removes every legacy alias.
const LEGACY_SECTION_NAMES: Readonly<Record<string, string>> = {
  "Staff Training & Requirements": "Training",
  "Competency & Qualifications": "Credentials",
  "Credentialing & Screening": "Credentials",
  Residents: "Residents & care",
  "Incidents & Alerts": "Safety & survey",
  "Reporting & Documents": "Advanced",
};

export function normalizeHiddenNavigationSections(sections?: readonly string[] | null): string[] {
  return [...new Set((sections ?? []).map((section) => Object.hasOwn(LEGACY_SECTION_NAMES, section)
    ? LEGACY_SECTION_NAMES[section] : section))];
}
