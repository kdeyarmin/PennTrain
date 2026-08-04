import { useState } from "react";
import { FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useCorrectCompletedClassAttendee, useCorrectCompletedTrainingClass,
} from "@/hooks/useTrainingClasses";
import { CORRECTION_REASON_MIN_LENGTH, correctionReasonIssue } from "@/lib/completedClassCorrection";

/**
 * The sanctioned way to fix a completed training class (BACKLOG.md G6).
 *
 * A completed class is immutable evidence: the page turns read-only on completion and a trigger
 * refuses writes unless `app.completed_class_correction` is set, which only the two correction RPCs
 * do. Those RPCs had no caller, so the one legitimate way to fix a wrong attendance record did not
 * exist in the product -- and the wrong record is what a surveyor sees.
 *
 * Deliberately not a general edit form. Only the fields the server will accept are offered, because
 * an input the server rejects is worse than an absent one: hours and dates are what the training
 * record was computed from, so correcting those means voiding the record, not patching the class.
 */
export default function CompletedClassCorrectionCard({
  classId, className, location, notes, attendees,
}: {
  classId: string;
  className: string;
  location: string | null;
  notes: string | null;
  attendees: { employee_id: string; attended: boolean | null; name: string }[];
}) {
  const { toast } = useToast();
  const correctClass = useCorrectCompletedTrainingClass();
  const correctAttendee = useCorrectCompletedClassAttendee();

  const [open, setOpen] = useState(false);
  const [nextName, setNextName] = useState(className);
  const [nextLocation, setNextLocation] = useState(location ?? "");
  const [nextNotes, setNextNotes] = useState(notes ?? "");
  const [classReason, setClassReason] = useState("");

  const [employeeId, setEmployeeId] = useState("");
  const [action, setAction] = useState<"upsert" | "delete">("upsert");
  const [attended, setAttended] = useState(true);
  const [attendeeReason, setAttendeeReason] = useState("");

  const classReasonIssue = correctionReasonIssue(classReason);
  const attendeeReasonIssue = correctionReasonIssue(attendeeReason);

  // Only send what actually changed. Sending an unchanged field would record a correction that
  // corrected nothing, which is noise in an audit trail whose whole value is that entries mean
  // something.
  const patch: { class_name?: string; location?: string; notes?: string } = {};
  if (nextName.trim() && nextName.trim() !== className) patch.class_name = nextName.trim();
  if (nextLocation !== (location ?? "")) patch.location = nextLocation;
  if (nextNotes !== (notes ?? "")) patch.notes = nextNotes;
  const hasPatch = Object.keys(patch).length > 0;

  const submitClass = async () => {
    try {
      await correctClass.mutateAsync({ classId, patch, reason: classReason.trim() });
      toast({ title: "Class corrected", description: "The correction and its reason are on the audit trail." });
      setClassReason("");
    } catch (error) {
      toast({
        title: "Could not correct the class",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const submitAttendee = async () => {
    if (!employeeId) return;
    try {
      const changed = await correctAttendee.mutateAsync({
        classId, employeeId, action, attended, reason: attendeeReason.trim(),
      });
      toast({
        title: changed ? "Attendance corrected" : "Nothing to correct",
        description: changed
          ? "The training record and its hour bucket were updated to match."
          : "That employee was not on this class, so there was nothing to remove.",
      });
      setAttendeeReason("");
    } catch (error) {
      toast({
        title: "Could not correct the attendance",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileWarning className="h-4 w-4 text-amber-600" /> Correct this completed class
            </CardTitle>
            <CardDescription>
              A completed class is evidence, so it is read-only. This is the recorded way to fix a
              mistake in it — every correction stores who made it and why.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? "Close" : "Open corrections"}
          </Button>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium">Class details</p>
            <p className="text-xs text-muted-foreground">
              Only the descriptive fields can be corrected. Hours and dates are what each attendee&apos;s
              training record was computed from — changing those means voiding the record, not
              patching the class.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="correct-class-name">Class name</Label>
                <Input id="correct-class-name" value={nextName} onChange={(e) => setNextName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="correct-class-location">Location</Label>
                <Input id="correct-class-location" value={nextLocation} onChange={(e) => setNextLocation(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="correct-class-notes">Notes</Label>
              <Textarea id="correct-class-notes" rows={2} value={nextNotes} onChange={(e) => setNextNotes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="correct-class-reason">Why this is being corrected</Label>
              <Textarea
                id="correct-class-reason" rows={2} value={classReason}
                onChange={(e) => setClassReason(e.target.value)}
                placeholder="Recorded under the wrong room number; corrected against the signed roster."
              />
              {classReasonIssue && <p className="text-xs text-muted-foreground">{classReasonIssue}</p>}
            </div>
            <Button
              size="sm"
              disabled={!hasPatch || Boolean(classReasonIssue) || correctClass.isPending}
              title={hasPatch ? undefined : "Change a field above first."}
              onClick={() => void submitClass()}
            >
              {correctClass.isPending ? "Correcting…" : "Correct class details"}
            </Button>
          </div>

          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-medium">Attendance</p>
            <p className="text-xs text-muted-foreground">
              Correcting attendance adds or removes that employee&apos;s training record and its hour
              bucket, so their compliance changes with it.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="correct-attendee">Employee</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger id="correct-attendee"><SelectValue placeholder="Select an attendee" /></SelectTrigger>
                  <SelectContent>
                    {attendees.map((attendee) => (
                      <SelectItem key={attendee.employee_id} value={attendee.employee_id}>
                        {attendee.name}{attendee.attended === false ? " (marked absent)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="correct-attendee-action">Correction</Label>
                <Select value={action} onValueChange={(value) => setAction(value as typeof action)}>
                  <SelectTrigger id="correct-attendee-action"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upsert">Set attendance</SelectItem>
                    <SelectItem value="delete">Remove from this class</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {action === "upsert" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={attended} onChange={(e) => setAttended(e.target.checked)} />
                <span>They did attend</span>
              </label>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="correct-attendee-reason">Why this is being corrected</Label>
              <Textarea
                id="correct-attendee-reason" rows={2} value={attendeeReason}
                onChange={(e) => setAttendeeReason(e.target.value)}
                placeholder="Signed in on the paper roster but marked absent in error."
              />
              {attendeeReasonIssue && <p className="text-xs text-muted-foreground">{attendeeReasonIssue}</p>}
            </div>
            <Button
              size="sm"
              disabled={!employeeId || Boolean(attendeeReasonIssue) || correctAttendee.isPending}
              onClick={() => void submitAttendee()}
            >
              {correctAttendee.isPending ? "Correcting…" : "Correct attendance"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Reasons are kept permanently and must be at least {CORRECTION_REASON_MIN_LENGTH}{" "}
              characters — a correction nobody explained is indistinguishable from a mistake.
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
