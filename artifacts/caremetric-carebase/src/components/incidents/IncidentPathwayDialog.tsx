import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { TemplateSectionFields } from "@/components/forms/TemplateFieldControl";
import { useSaveIncidentPathway } from "@/hooks/useIncidentFollowThrough";
import {
  INCIDENT_PATHWAYS, getIncidentPathway, validatePathwayAnswers, visiblePathwayFields,
} from "@/lib/incidentPathways";
import type { TemplateAnswers } from "@/lib/assessmentTemplates";
import type { Json } from "@/lib/database.types";

/**
 * The type-specific investigation. Which pathway is offered is constrained by the incident's
 * recorded type -- several pathways share one type (a skin tear and a fracture are both a
 * significant injury), and the server refuses a mismatch, so the picker must not offer one.
 */
export function IncidentPathwayDialog({
  open, onOpenChange, incidentId, incidentType, currentPathwayKey, currentAnswers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  incidentType: string;
  currentPathwayKey: string | null;
  currentAnswers: TemplateAnswers;
}) {
  const { toast } = useToast();
  const save = useSaveIncidentPathway(incidentId);
  const available = INCIDENT_PATHWAYS.filter((entry) => entry.incidentType === incidentType);
  const [pathwayKey, setPathwayKey] = useState(currentPathwayKey ?? "");
  const [answers, setAnswers] = useState<TemplateAnswers>(currentAnswers);
  const [showIssues, setShowIssues] = useState(false);

  // Re-seed only on open, so a background refetch cannot wipe answers being typed.
  useEffect(() => {
    if (!open) return;
    setPathwayKey(currentPathwayKey ?? (available.length === 1 ? available[0].key : ""));
    setAnswers(currentAnswers);
    setShowIssues(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pathway = pathwayKey ? getIncidentPathway(pathwayKey) : undefined;
  const issues = pathway ? validatePathwayAnswers(pathway, answers) : [];
  const visible = pathway ? visiblePathwayFields(pathway, answers) : [];
  const answered = visible.filter((field) => {
    const value = answers[field.key];
    return value !== undefined && value !== null && value !== "";
  }).length;

  const submit = async (complete: boolean) => {
    if (!pathway) return;
    if (complete && issues.length > 0) {
      setShowIssues(true);
      return;
    }
    try {
      await save.mutateAsync({ pathwayKey: pathway.key, answers: answers as Json, complete });
      toast({ title: complete ? "Investigation questions complete" : "Progress saved" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not save the pathway",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Investigation pathway</DialogTitle>
          <DialogDescription>
            The questions follow the kind of event, so one investigation is comparable to the next.
            Answering them does not decide reportability — that stays a separate, recorded judgement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label className="text-xs" htmlFor="pathway-key">Pathway</Label>
          <Select
            value={pathwayKey}
            onValueChange={(value) => { setPathwayKey(value); setShowIssues(false); }}
            disabled={Boolean(currentPathwayKey)}
          >
            <SelectTrigger id="pathway-key"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              {available.map((entry) => (
                <SelectItem key={entry.key} value={entry.key}>{entry.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pathway && <p className="text-[11px] text-muted-foreground">{pathway.purpose}</p>}
          {currentPathwayKey && (
            <p className="text-[11px] text-muted-foreground">
              The pathway is fixed once chosen, so the questions asked cannot change under an
              answer that was already given.
            </p>
          )}
        </div>

        {pathway && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">v{pathway.version}</Badge>
              <Badge variant="outline">{answered}/{visible.length} answered</Badge>
            </div>

            {showIssues && issues.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-sm">
                <p className="flex items-center gap-1.5 font-medium text-destructive">
                  <TriangleAlert className="h-4 w-4" /> {issues.length} item{issues.length === 1 ? "" : "s"} to resolve
                </p>
                <ul className="mt-1 space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {issues.map((issue) => (
                    <li key={`${issue.fieldKey}-${issue.kind}`} className="list-disc">{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <TemplateSectionFields
              sections={pathway.sections}
              answers={answers}
              onChange={(key, value) => setAnswers((prev) => ({ ...prev, [key]: value }))}
              idPrefix="pathway-field"
            />
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => submit(false)} disabled={!pathway || save.isPending}>
            {save.isPending ? "Saving..." : "Save progress"}
          </Button>
          <Button onClick={() => submit(true)} disabled={!pathway || save.isPending}>
            Mark complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
