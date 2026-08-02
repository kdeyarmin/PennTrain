import type { FormSectionKey } from "@/lib/residentAssessmentFormSchema";

export const TAB_SEQUENCE: FormSectionKey[] = [
  "info",
  "section1",
  "section2",
  "section3",
  "section4",
  "summary",
];
// "review" is a 7th tab that isn't one of the 6 FormSectionKeys getIncompleteSections()/the PDF
// track -- it's a UI-only drill-down, not a form-content section, so it stays out of TAB_SEQUENCE
// and SECTION_LABELS (which the "N of 6 sections" banner text and the PDF's incomplete-notice both
// rely on staying exactly the 6 canonical sections).
export type TabValue = FormSectionKey | "review";
export const ALL_TAB_VALUES: readonly string[] = [...TAB_SEQUENCE, "review"];

export interface ReviewCheckItem {
  label: string;
  ok: boolean;
  detail?: string;
}
