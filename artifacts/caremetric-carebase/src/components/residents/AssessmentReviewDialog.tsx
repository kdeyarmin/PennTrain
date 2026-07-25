import { useEffect, useState } from "react";
import { BookOpen, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useFinalizeResidentAssessmentReview, useSaveResidentAssessmentReview,
  type ResidentAssessmentReview,
} from "@/hooks/useResidentAssessmentReviews";
import {
  isFieldVisible, templateCitation, templateProgress, validateTemplateAnswers,
  type AssessmentTemplate, type TemplateAnswers, type TemplateField,
} from "@/lib/assessmentTemplates";
import { citationDisplayLabel } from "@/lib/paRegulatoryCitations";
import type { Json } from "@/lib/database.types";

function FieldControl({
  field, value, onChange,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `review-field-${field.key}`;

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

/**
 * Renders a governed template. Conditional fields appear as their controlling answers are given,
 * and validation runs against the template definition -- the single source of what "complete" means,
 * which is why `finalize_resident_assessment_review` deliberately does not re-implement it in SQL.
 */
export function AssessmentReviewDialog({
  open, onOpenChange, residentId, template, existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  template: AssessmentTemplate;
  existing?: ResidentAssessmentReview;
}) {
  const { toast } = useToast();
  const save = useSaveResidentAssessmentReview();
  const finalize = useFinalizeResidentAssessmentReview();
  const [answers, setAnswers] = useState<TemplateAnswers>({});
  const [assessorName, setAssessorName] = useState("");
  const [showIssues, setShowIssues] = useState(false);

  // Re-seed only on open so a background refetch cannot wipe in-progress answers.
  useEffect(() => {
    if (!open) return;
    setAnswers((existing?.answers as TemplateAnswers | undefined) ?? {});
    setAssessorName("");
    setShowIssues(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const issues = validateTemplateAnswers(template, answers);
  const progress = templateProgress(template, answers);
  const citation = templateCitation(template);
  const setAnswer = (key: string, value: unknown) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const handleSaveDraft = async () => {
    try {
      await save.mutateAsync({
        residentId,
        templateKey: template.key,
        templateVersion: template.version,
        answers: answers as Json,
        reviewId: existing?.status === "draft" ? existing.id : undefined,
      });
      toast({ title: "Draft saved" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Could not save the draft", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleFinalize = async () => {
    if (issues.length > 0) {
      setShowIssues(true);
      return;
    }
    if (!assessorName.trim()) {
      setShowIssues(true);
      return;
    }
    try {
      const reviewId = await save.mutateAsync({
        residentId,
        templateKey: template.key,
        templateVersion: template.version,
        answers: answers as Json,
        reviewId: existing?.status === "draft" ? existing.id : undefined,
      });
      await finalize.mutateAsync({ reviewId, assessorName: assessorName.trim(), residentId });
      toast({ title: `${template.title} finalized` });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Could not finalize the review", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.title}</DialogTitle>
          <DialogDescription>{template.purpose}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">v{template.version}</Badge>
            <Badge variant="outline">{progress.answered}/{progress.total} answered</Badge>
            {citation && (
              <Badge variant="outline" className="gap-1">
                <BookOpen className="h-3 w-3" /> {citationDisplayLabel(citation)}
              </Badge>
            )}
          </div>
          {template.stateFormNotice && (
            <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              {template.stateFormNotice}
            </p>
          )}
        </div>

        {showIssues && issues.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-destructive">
              <TriangleAlert className="h-4 w-4" /> {issues.length} item{issues.length === 1 ? "" : "s"} to resolve
            </p>
            <ul className="mt-1 space-y-0.5 pl-5 text-xs text-muted-foreground">
              {issues.map((issue) => <li key={`${issue.fieldKey}-${issue.kind}`} className="list-disc">{issue.message}</li>)}
            </ul>
          </div>
        )}

        <div className="space-y-5">
          {template.sections.map((section) => {
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
                      <Label className="text-xs" htmlFor={`review-field-${field.key}`}>
                        {field.label}
                        {field.required && <span className="ml-0.5 text-destructive">*</span>}
                        {field.unit && <span className="ml-1 text-muted-foreground">({field.unit})</span>}
                      </Label>
                    )}
                    <FieldControl field={field} value={answers[field.key]} onChange={(value) => setAnswer(field.key, value)} />
                    {field.guidance && <p className="text-[11px] text-muted-foreground">{field.guidance}</p>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="space-y-1 border-t pt-3">
          <Label className="text-xs" htmlFor="review-assessor">Assessor name (required to finalize)</Label>
          <Input id="review-assessor" value={assessorName} onChange={(event) => setAssessorName(event.target.value)} />
          {template.signature.clinicalReviewRequired && (
            <p className="text-[11px] text-muted-foreground">
              This template also requires a clinical review by someone other than the assessor, recorded after finalizing.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={handleSaveDraft} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save draft"}
          </Button>
          <Button onClick={handleFinalize} disabled={save.isPending || finalize.isPending}>
            {finalize.isPending ? "Finalizing..." : "Finalize"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
