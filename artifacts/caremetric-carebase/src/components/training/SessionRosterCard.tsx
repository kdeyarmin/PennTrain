import { useState } from "react";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import { signatureDigest } from "@/lib/certificationAttempt";
import {
  ATTENDANCE_STATUSES, useApproveTrainingSessionCompletion, useRecordTrainingAttendance,
  useTrainingSessionRegistrations, type TrainingSessionRegistration,
} from "@/hooks/useTrainingClasses";

const MIN_REASON = 5;

/**
 * The session roster: attendance, and the approval that turns it into training records
 * (BACKLOG.md G15.11, G15.12).
 *
 * Registrations, signed attendance evidence and a trainer's approval all existed in the database
 * and nowhere in the product. `register_for_training_session` had a hook and no screen;
 * `record_training_attendance` and `approve_training_session_completion` had neither.
 *
 * They are wired together because the server ties them together: approval refuses unless every
 * registration marked `attended` carries signed evidence, and recording that evidence is the only
 * thing that produces it. Wiring one without the other would have produced an approve button that
 * always failed.
 */
export function SessionRosterCard({
  classId,
  classStatus,
  employeeName,
}: {
  classId: string;
  classStatus: string | null | undefined;
  employeeName: (employeeId: string) => string;
}) {
  const { toast } = useToast();
  const registrations = useTrainingSessionRegistrations(classId);
  const record = useRecordTrainingAttendance(classId);
  const approve = useApproveTrainingSessionCompletion(classId);

  const [openRow, setOpenRow] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("attended");
  const [typedName, setTypedName] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveReason, setApproveReason] = useState("");

  const rows = registrations.data ?? [];
  // Only these two states can be approved; the server refuses anything else outright.
  const canApprove = classStatus === "scheduled" || classStatus === "in_progress";
  const attendedWithoutEvidence = rows.filter(
    (row) => row.registration_status === "attended" && !row.attendance_recorded_at,
  ).length;

  const submitAttendance = async (row: TrainingSessionRegistration) => {
    // `attended` is the only status the server demands a signature for, but recording one for every
    // status keeps the evidence row uniform and costs nothing.
    const attestation = `${typedName.trim()}|${row.id}|${status}|${new Date().toISOString()}`;
    const attendee = await signatureDigest(attestation);
    const recorder = await signatureDigest(`recorder|${attestation}`);
    record.mutate(
      {
        registrationId: row.id,
        attendanceStatus: status,
        checkInAt: new Date().toISOString(),
        checkOutAt: new Date().toISOString(),
        attendeeSignatureSha256: attendee,
        recorderSignatureSha256: recorder,
        evidence: { attestedName: typedName.trim() },
      },
      {
        onSuccess: () => { setOpenRow(null); setTypedName(""); toast({ title: "Attendance recorded" }); },
        onError: (error) => toast({ title: "Attendance refused", description: errorText(error), variant: "destructive" }),
      },
    );
  };

  if (registrations.isLoading) return <Skeleton className="h-32" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-5 w-5" />Session roster
        </CardTitle>
        <CardDescription>
          Capacity-aware registrations, signed attendance, and the approval that turns the session
          into training records. Approval refuses until every attended registration is signed for.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nobody has registered for this session yet.
          </p>
        )}

        {rows.map((row) => {
          const signed = !!row.attendance_recorded_at;
          return (
            <div key={row.id} className="space-y-2 rounded border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{employeeName(row.employee_id)}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{row.registration_status}</Badge>
                  {row.waitlist_position != null && (
                    <Badge variant="outline">waitlist #{row.waitlist_position}</Badge>
                  )}
                  {signed
                    ? <Badge variant="secondary">signed</Badge>
                    : openRow !== row.id && (
                      <Button size="sm" variant="outline" onClick={() => { setOpenRow(row.id); setStatus("attended"); setTypedName(""); }}>
                        Record attendance
                      </Button>
                    )}
                </div>
              </div>

              {openRow === row.id && (
                <div className="space-y-2 rounded bg-muted/40 p-2">
                  <div className="space-y-1">
                    <Label htmlFor={`att-status-${row.id}`}>Attendance</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger id={`att-status-${row.id}`} className="sm:w-64"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ATTENDANCE_STATUSES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`att-name-${row.id}`}>Attendee types their name</Label>
                    <Input
                      id={`att-name-${row.id}`}
                      value={typedName}
                      onChange={(event) => setTypedName(event.target.value)}
                      placeholder="Full name"
                    />
                    <p className="text-xs text-muted-foreground">
                      The signature is a hash of what is typed here — derived from something the
                      person actually entered, not a random token. Their identity comes from the
                      session the server already checked.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={record.isPending || typedName.trim().length < 2}
                      onClick={() => void submitAttendance(row)}
                    >
                      {record.isPending ? "Recording…" : "Sign and record"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpenRow(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {rows.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            {attendedWithoutEvidence > 0 && (
              <p className="text-xs text-muted-foreground">
                {attendedWithoutEvidence} attended registration
                {attendedWithoutEvidence === 1 ? "" : "s"} still unsigned. Approval will refuse until
                they are.
              </p>
            )}
            {!approving ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canApprove}
                title={canApprove ? undefined : `A ${classStatus ?? "class"} session cannot be approved.`}
                onClick={() => { setApproving(true); setApproveReason(""); }}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" />Approve completion
              </Button>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="approve-reason">Why this session is complete</Label>
                <Input
                  id="approve-reason"
                  value={approveReason}
                  onChange={(event) => setApproveReason(event.target.value)}
                  placeholder="Delivered in full; roster signed on the day."
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={approve.isPending || approveReason.trim().length < MIN_REASON}
                    onClick={() => approve.mutate({ reason: approveReason.trim() }, {
                      onSuccess: () => { setApproving(false); toast({ title: "Session completion approved", description: "Training records were created for the attendees." }); },
                      onError: (error) => toast({ title: "Approval refused", description: errorText(error), variant: "destructive" }),
                    })}
                  >
                    {approve.isPending ? "Approving…" : "Approve"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setApproving(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
