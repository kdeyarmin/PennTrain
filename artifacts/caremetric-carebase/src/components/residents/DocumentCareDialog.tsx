import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useRecordServiceTaskResponse } from "@/hooks/useFloorMode";
import { useSaveOfflineServiceDraft } from "@/hooks/useOfflineServiceDrafts";
import {
  COMPLETION_RESPONSE_LABELS, defaultResponsesForKind, isExceptionResponse,
  type CompletionResponse,
} from "@/lib/serviceDeliveryContract";
import {
  followUpFieldsFor, validateFollowUp, type FollowUpAnswers, type FollowUpField,
} from "@/lib/serviceExceptionFollowUp";
import { isNetworkLevelSupabaseError } from "@/lib/offlineServiceDraftSafety";
import type { Json } from "@/lib/database.types";

function FollowUpControl({ field, value, onChange }: { field: FollowUpField; value: unknown; onChange: (value: unknown) => void }) {
  const id = `followup-${field.key}`;
  if (field.type === "boolean") {
    return (
      <label className="flex min-h-11 items-center gap-3 text-base" htmlFor={id}>
        <Checkbox id={id} className="h-6 w-6" checked={value === true} onCheckedChange={(next) => onChange(next === true)} />
        {field.label}
      </label>
    );
  }
  if (field.type === "single_select") {
    return (
      <div className="flex flex-wrap gap-2">
        {field.options?.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={value === option.value ? "default" : "outline"}
            className="h-11"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    );
  }
  return (
    <Textarea id={id} rows={2} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />
  );
}

/**
 * Documenting a routine task is ONE tap: pick "Completed as planned" and it saves. Only exceptions
 * open follow-up questions. If the routine path costs more than that, staff pick it for everything
 * and the exception data stops meaning anything.
 *
 * Controls are sized for a phone held in a gloved hand, which is why the response buttons are
 * full-width rows rather than a dropdown.
 */
export function DocumentCareDialog({
  open, onOpenChange, task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: {
    id: string;
    serviceName: string;
    residentName: string;
    room: string | null;
    taskKind?: string | null;
    acceptableResponses?: string[] | null;
    instructions?: string | null;
    refusalHandling?: string | null;
    // Needed only for the offline-draft path (BACKLOG.md E5) -- Floor already has every one of
    // these from the task queue it already loaded, so no extra fetch is needed while offline.
    residentId: string;
    organizationId: string;
    facilityId: string;
    scheduledStart: string;
    scheduledEnd: string;
  };
}) {
  const { toast } = useToast();
  const record = useRecordServiceTaskResponse();
  const saveOfflineDraft = useSaveOfflineServiceDraft();
  const [response, setResponse] = useState<string | null>(null);
  const [answers, setAnswers] = useState<FollowUpAnswers>({});
  const [showIssues, setShowIssues] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    if (!open) return;
    setResponse(null);
    setAnswers({});
    setShowIssues(false);
  }, [open]);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const responses = task.acceptableResponses?.length
    ? task.acceptableResponses
    : defaultResponsesForKind(task.taskKind ?? "scheduled_care");
  const followUps = response ? followUpFieldsFor(response) : [];
  const issues = response ? validateFollowUp(response, answers) : [];

  const submit = async (chosen: string) => {
    const followUpIssues = validateFollowUp(chosen, answers);
    if (followUpIssues.length > 0) {
      setResponse(chosen);
      setShowIssues(true);
      return;
    }

    const saveDraftLocally = async () => {
      await saveOfflineDraft.mutateAsync({
        taskId: task.id,
        residentId: task.residentId,
        residentDisplayLabel: task.room ? `${task.residentName} · Room ${task.room}` : task.residentName,
        organizationId: task.organizationId,
        facilityId: task.facilityId,
        serviceName: task.serviceName,
        scheduledStart: task.scheduledStart,
        scheduledEnd: task.scheduledEnd,
        taskKind: task.taskKind ?? "scheduled_care",
        acceptableResponses: responses as CompletionResponse[],
        refusalHandling: task.refusalHandling ?? null,
        response: chosen as CompletionResponse,
        exceptionDetails: answers,
      });
      toast({
        title: "Saved on this device",
        description: "Will sync when you're back online. This isn't in the official record yet.",
      });
      onOpenChange(false);
    };

    // The highest-frequency, safety-critical path in the app: online submission below is untouched.
    // This proactive branch is decided fresh at submit time rather than from render state, same as
    // before -- it's no longer the ONLY branch into the offline-draft path, though: see the
    // network-failure fallback in the online path's catch below for the case navigator.onLine misses.
    if (navigator.onLine === false) {
      try {
        await saveDraftLocally();
      } catch (error) {
        toast({
          title: "Could not save this offline",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      }
      return;
    }
    try {
      await record.mutateAsync({
        taskId: task.id,
        response: chosen,
        exceptionDetails: answers as Json,
      });
      toast({ title: "Recorded", description: COMPLETION_RESPONSE_LABELS[chosen as CompletionResponse] ?? chosen });
      onOpenChange(false);
    } catch (error) {
      // Codex review finding: navigator.onLine can still read `true` with a LAN link but no working
      // route to Supabase (bad DNS, a captive portal, a route/service outage), so the branch above
      // alone misses that case and the mutation above fails having never reached the server. Fall
      // back to the same offline-draft path then -- but only for that specific failure shape; a real
      // server rejection (authorization, validation, a plan/business rule) must still surface to the
      // user rather than disappear into a silent draft. See isNetworkLevelSupabaseError.
      if (isNetworkLevelSupabaseError(error)) {
        try {
          await saveDraftLocally();
        } catch (draftError) {
          toast({
            title: "Could not save this offline",
            description: draftError instanceof Error ? draftError.message : String(draftError),
            variant: "destructive",
          });
        }
        return;
      }
      toast({
        title: "Could not record this",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="text-lg">{task.serviceName}</DialogTitle>
            {!isOnline && (
              <Badge variant="outline" className="gap-1 text-xs font-normal">
                <CloudOff className="h-3 w-3" />Offline
              </Badge>
            )}
          </div>
          <DialogDescription>
            {task.residentName}{task.room ? ` · Room ${task.room}` : ""}
          </DialogDescription>
        </DialogHeader>

        {task.instructions && (
          <p className="rounded-md border bg-muted/40 p-2 text-sm">{task.instructions}</p>
        )}

        {!response ? (
          <div className="space-y-2">
            {responses.map((entry) => (
              <Button
                key={entry}
                variant={entry === "completed_as_planned" ? "default" : "outline"}
                className="h-14 w-full justify-start text-base"
                disabled={record.isPending || saveOfflineDraft.isPending}
                onClick={() => (isExceptionResponse(entry) ? setResponse(entry) : void submit(entry))}
              >
                {COMPLETION_RESPONSE_LABELS[entry as CompletionResponse] ?? entry}
              </Button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{COMPLETION_RESPONSE_LABELS[response as CompletionResponse] ?? response}</p>
              <Button variant="ghost" size="sm" onClick={() => { setResponse(null); setShowIssues(false); }}>Change</Button>
            </div>

            {response === "resident_refused" && task.refusalHandling && (
              <p className="rounded-md border border-amber-500/50 bg-amber-500/5 p-2 text-sm">
                <span className="font-medium">The plan says: </span>{task.refusalHandling}
              </p>
            )}

            {showIssues && issues.length > 0 && (
              <ul className="space-y-0.5 rounded-md border border-destructive/50 bg-destructive/5 p-2 text-sm text-destructive">
                {issues.map((issue) => <li key={issue.fieldKey}>{issue.message}</li>)}
              </ul>
            )}

            {followUps.map((field) => (
              <div key={field.key} className="space-y-1.5">
                {field.type !== "boolean" && (
                  <Label className="text-sm" htmlFor={`followup-${field.key}`}>
                    {field.label}{field.required && <span className="ml-0.5 text-destructive">*</span>}
                  </Label>
                )}
                <FollowUpControl
                  field={field}
                  value={answers[field.key]}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [field.key]: value }))}
                />
                {field.helper && <p className="text-xs text-muted-foreground">{field.helper}</p>}
              </div>
            ))}
          </div>
        )}

        {response && (
          <DialogFooter>
            <Button variant="outline" className="h-12" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="h-12" onClick={() => void submit(response)} disabled={record.isPending || saveOfflineDraft.isPending}>
              {record.isPending || saveOfflineDraft.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
