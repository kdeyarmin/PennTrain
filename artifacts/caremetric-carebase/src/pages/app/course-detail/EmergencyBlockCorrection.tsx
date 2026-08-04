import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import { useEmergencyUpdateCourseBlock, type CourseBlock } from "@/hooks/useCourses";

const MIN_REASON_LENGTH = 10;

/**
 * Correcting one block of a published, locked course version (BACKLOG.md G12.2).
 *
 * The lock exists because learners are assessed against what they were shown, so content must not
 * move underneath a completion record. That is right almost always, and wrong in the case this
 * covers: a published course that says something which has to stop being said today -- a wrong
 * dose, a rescinded regulation, a person who must not be named.
 *
 * `admin_emergency_update_course_block` is the reviewed exit for that, and it had no caller, so the
 * only real options were to leave the error published or unpublish the course out from under
 * everyone mid-assignment. It is deliberately uncomfortable to use: platform admin only, a written
 * reason, and the before-and-after written to `audit_logs`. This form keeps that discomfort rather
 * than smoothing it away -- it is not an edit button, and it does not look like one.
 */
export function EmergencyBlockCorrection({ block }: { block: CourseBlock }) {
  const { toast } = useToast();
  const correct = useEmergencyUpdateCourseBlock(block.course_version_id ?? undefined);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState("");

  const reasonTooShort = reason.trim().length < MIN_REASON_LENGTH;
  const nothingToChange = title.trim().length === 0;

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => { setOpen(true); setReason(""); setTitle(block.title ?? ""); }}
      >
        <ShieldAlert className="mr-1 h-4 w-4" />Emergency correction
      </Button>
    );
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-xs text-muted-foreground">
        This edits content learners have already been assessed against, and is recorded as an
        exception with your name, the reason, and the before and after. Use it when leaving the
        content as it stands would be worse.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`emergency-title-${block.id}`}>Corrected title</Label>
        <Input
          id={`emergency-title-${block.id}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`emergency-reason-${block.id}`}>Why this cannot wait for a new version</Label>
        <Textarea
          id={`emergency-reason-${block.id}`}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Stated a 10mg starting dose; the current protocol is 5mg. Corrected pending a full re-version."
        />
        {reasonTooShort && (
          <p className="text-xs text-muted-foreground">
            At least {MIN_REASON_LENGTH} characters — the server requires it, and this is what the
            audit record will say.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={correct.isPending || reasonTooShort || nothingToChange}
          onClick={() => {
            correct.mutate(
              { blockId: block.id, reason: reason.trim(), title: title.trim() },
              {
                onSuccess: () => {
                  setOpen(false);
                  toast({
                    title: "Correction applied",
                    description: "It is recorded in the audit log as an emergency exception.",
                  });
                },
                onError: (error) => toast({
                  title: "Could not apply the correction",
                  description: errorText(error),
                  variant: "destructive",
                }),
              },
            );
          }}
        >
          {correct.isPending ? "Applying…" : "Apply correction"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
