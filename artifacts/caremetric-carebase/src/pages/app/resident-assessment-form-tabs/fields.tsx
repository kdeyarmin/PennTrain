import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FREQUENCY_OPTIONS, responsiblePartyOptions, type FormType } from "@/lib/residentAssessmentFormSchema";

export function DegreeSelect({
  formType,
  value,
  allOtherValue,
  onChange,
  onAllOtherChange,
  scale,
}: {
  formType: FormType;
  value: string;
  allOtherValue: string;
  onChange: (v: string) => void;
  onAllOtherChange: (v: string) => void;
  scale: { value: string; label: string }[];
}) {
  const __fieldIds = useId();
  if (formType === "ASP") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`${__fieldIds}-preliminary`} className="text-[11px] text-muted-foreground">
            Preliminary
          </Label>
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger id={`${__fieldIds}-preliminary`} className="h-8 text-xs">
              <SelectValue placeholder="Degree" />
            </SelectTrigger>
            <SelectContent>
              {scale.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${__fieldIds}-all-other`} className="text-[11px] text-muted-foreground">All Other</Label>
          <Select value={allOtherValue} onValueChange={onAllOtherChange}>
            <SelectTrigger id={`${__fieldIds}-all-other`} className="h-8 text-xs">
              <SelectValue placeholder="Degree" />
            </SelectTrigger>
            <SelectContent>
              {scale.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs w-40" aria-label="Degree">
        <SelectValue placeholder="Degree" />
      </SelectTrigger>
      <SelectContent>
        {scale.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// A Select that always resets to its placeholder after a pick -- it exists to drop a common value
// into a plain-text field the user can still hand-edit afterward, not to represent that field's
// current state (unlike every other Select in this file, which is bound to the field it controls).
export function QuickFillSelect({
  id,
  options,
  onPick,
  placeholder,
  className,
  disabled,
}: {
  id?: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
  placeholder: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value="" onValueChange={onPick} disabled={disabled}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// The Frequency/Responsible-Party pair with their "Other" reveals -- identical across every plan
// (ADL items, sensory/social items, diagnosis rows, and the bulk-fill bar), just with different
// value/onChange wiring. One shared component instead of four hand-rolled copies means a future
// change (a new responsible-party code, different "Other" wording) only needs one edit.
export function FrequencyPartyFields({
  formType,
  frequency,
  frequencyOther,
  responsibleParty,
  responsiblePartyOther,
  onFrequencyChange,
  onFrequencyOtherChange,
  onPartyChange,
  onPartyOtherChange,
  disabled,
}: {
  formType: FormType;
  frequency: string;
  frequencyOther: string;
  responsibleParty: string;
  responsiblePartyOther: string;
  onFrequencyChange: (v: string) => void;
  onFrequencyOtherChange: (v: string) => void;
  onPartyChange: (v: string) => void;
  onPartyOtherChange: (v: string) => void;
  disabled?: boolean;
}) {
  const partyOptions = responsiblePartyOptions(formType);
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Select
          value={frequency}
          onValueChange={(v) => {
            onFrequencyChange(v);
            if (v !== "other") onFrequencyOtherChange("");
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Frequency">
            <SelectValue placeholder="Frequency" />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {frequency === "other" && (
          <Input
            placeholder="Specify frequency"
            className="h-8 text-xs"
            value={frequencyOther}
            disabled={disabled}
            onChange={(e) => onFrequencyOtherChange(e.target.value)}
          />
        )}
      </div>
      <div className="space-y-1">
        <Select
          value={responsibleParty}
          onValueChange={(v) => {
            onPartyChange(v);
            if (v !== "O") onPartyOtherChange("");
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Responsible party">
            <SelectValue placeholder="Responsible party" />
          </SelectTrigger>
          <SelectContent>
            {partyOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {responsibleParty === "O" && (
          <Input
            placeholder="Specify responsible party"
            className="h-8 text-xs"
            value={responsiblePartyOther}
            disabled={disabled}
            onChange={(e) => onPartyOtherChange(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}
