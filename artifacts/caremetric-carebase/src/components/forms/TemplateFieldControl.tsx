/**
 * The one renderer for a governed template field.
 *
 * Extracted from AssessmentReviewDialog when incident pathways needed the same thing. The program
 * plan's rule for Phase 6 was that pathway questions reuse the Phase 2 template engine rather than
 * growing a parallel one; that has to hold at the component level too, or the two drift in exactly
 * the ways users notice -- a checkbox here and a yes/no select there for the same question.
 */
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  isFieldVisible,
  type TemplateAnswers, type TemplateField, type TemplateSection,
} from "@/lib/assessmentTemplates";

export function TemplateFieldControl({
  field, value, onChange, idPrefix,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${field.key}`;

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <Checkbox id={id} checked={value === true} onCheckedChange={(next) => onChange(next === true)} />
        {field.label}
      </label>
    );
  }

  if (field.type === "single_select") {
    return (
      <Select value={typeof value === "string" ? value : ""} onValueChange={onChange}>
        <SelectTrigger id={id}><SelectValue placeholder="Select..." /></SelectTrigger>
        <SelectContent>
          {field.options?.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "multi_select") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-3">
        {field.options?.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={selected.includes(option.value)}
              onCheckedChange={(next) => onChange(next === true
                ? [...selected, option.value]
                : selected.filter((entry) => entry !== option.value))}
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }

  if (field.type === "long_text") {
    return <Textarea id={id} rows={3} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />;
  }

  if (field.type === "number") {
    return (
      <Input
        id={id}
        type="number"
        min={field.min}
        max={field.max}
        value={typeof value === "number" ? String(value) : ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    );
  }

  return (
    <Input
      id={id}
      type={field.type === "date" ? "date" : "text"}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Sections with their conditional fields, in definition order. */
export function TemplateSectionFields({
  sections, answers, onChange, idPrefix,
}: {
  sections: TemplateSection[];
  answers: TemplateAnswers;
  onChange: (key: string, value: unknown) => void;
  idPrefix: string;
}) {
  return (
    <div className="space-y-5">
      {sections.map((section) => {
        const fields = section.fields.filter((field) => isFieldVisible(field, answers));
        if (!fields.length) return null;
        return (
          <div key={section.key} className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold">{section.title}</h4>
              {section.description && <p className="text-xs text-muted-foreground">{section.description}</p>}
            </div>
            {fields.map((field) => (
              <div key={field.key} className="space-y-1">
                {field.type !== "boolean" && (
                  <Label className="text-xs" htmlFor={`${idPrefix}-${field.key}`}>
                    {field.label}
                    {field.required && <span className="ml-0.5 text-destructive">*</span>}
                    {field.unit && <span className="ml-1 text-muted-foreground">({field.unit})</span>}
                  </Label>
                )}
                <TemplateFieldControl
                  field={field}
                  value={answers[field.key]}
                  onChange={(value) => onChange(field.key, value)}
                  idPrefix={idPrefix}
                />
                {field.guidance && <p className="text-[11px] text-muted-foreground">{field.guidance}</p>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
