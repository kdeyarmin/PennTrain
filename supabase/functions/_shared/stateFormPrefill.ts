// The resident compliance item types generate-state-form-prefill holds a PA DHS template for. The
// State Forms Center offers "Get prefilled official form" only for these: for any other type the
// endpoint answers 400, so the button would be one that always fails. Imported by that function and
// by artifacts/caremetric-carebase/src/lib/stateFormWorkflow.ts, so no import here.
export const STATE_FORM_PREFILL_ITEM_TYPES = [
  "preadmission_screening",
  "medical_evaluation",
  "annual_medical_evaluation",
] as const;

export type StateFormPrefillItemType = (typeof STATE_FORM_PREFILL_ITEM_TYPES)[number];

export function hasStateFormPrefill(itemType: string): itemType is StateFormPrefillItemType {
  return (STATE_FORM_PREFILL_ITEM_TYPES as readonly string[]).includes(itemType);
}
