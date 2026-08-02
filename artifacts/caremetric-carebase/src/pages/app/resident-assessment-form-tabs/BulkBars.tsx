import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { FormType } from "@/lib/residentAssessmentFormSchema";
import { DegreeSelect, FrequencyPartyFields } from "./fields";

// Most residents share the same degree rating or the same plan frequency/responsible party across
// nearly every item in a 22-item (or 11/12-item) list -- filling each one by hand is the single
// biggest source of repetitive clicking in this form. These bars set a value once and apply it to
// every item in the list below them; the assessor then only needs to touch the exceptions. They
// always reset after applying (like QuickFillSelect) since they're a one-shot action, not a control
// bound to any single item's state.
export function BulkDegreeBar({
  formType,
  scale,
  onApply,
}: {
  formType: FormType;
  scale: { value: string; label: string }[];
  onApply: (patch: { degree?: string; degreeAllOther?: string }) => void;
}) {
  const [value, setValue] = useState("");
  const [allOtherValue, setAllOtherValue] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-2 bg-muted/40">
      <p className="text-xs text-muted-foreground w-full sm:w-auto sm:mr-1">
        Set degree for all, then adjust exceptions:
      </p>
      <DegreeSelect
        formType={formType}
        value={value}
        allOtherValue={allOtherValue}
        onChange={setValue}
        onAllOtherChange={setAllOtherValue}
        scale={scale}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!value && !allOtherValue}
        onClick={() => {
          onApply({
            degree: value || undefined,
            degreeAllOther: allOtherValue || undefined,
          });
          setValue("");
          setAllOtherValue("");
        }}
      >
        Apply to All
      </Button>
    </div>
  );
}

export function BulkPlanBar({
  formType,
  onApply,
}: {
  formType: FormType;
  onApply: (patch: {
    planFrequency?: string;
    planFrequencyOther?: string;
    planResponsibleParty?: string;
    planResponsiblePartyOther?: string;
  }) => void;
}) {
  const [frequency, setFrequency] = useState("");
  const [frequencyOther, setFrequencyOther] = useState("");
  const [party, setParty] = useState("");
  const [partyOther, setPartyOther] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-2 bg-muted/40">
      <p className="text-xs text-muted-foreground w-full sm:w-auto sm:mr-1">
        Set plan frequency/party for all, then adjust exceptions:
      </p>
      <FrequencyPartyFields
        formType={formType}
        frequency={frequency}
        frequencyOther={frequencyOther}
        responsibleParty={party}
        responsiblePartyOther={partyOther}
        onFrequencyChange={setFrequency}
        onFrequencyOtherChange={setFrequencyOther}
        onPartyChange={setParty}
        onPartyOtherChange={setPartyOther}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!frequency && !party}
        onClick={() => {
          onApply({
            planFrequency: frequency || undefined,
            planFrequencyOther:
              frequency === "other" ? frequencyOther : undefined,
            planResponsibleParty: party || undefined,
            planResponsiblePartyOther: party === "O" ? partyOther : undefined,
          });
          setFrequency("");
          setFrequencyOther("");
          setParty("");
          setPartyOther("");
        }}
      >
        Apply to All
      </Button>
    </div>
  );
}
