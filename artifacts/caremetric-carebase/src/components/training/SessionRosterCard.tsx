import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import { signatureDigest } from "@/lib/certificationAttempt";
import {
  ATTENDANCE_STATUSES, useApproveTrainingSessionCompletion, useRecordTrainingAttendance,
  useRegisterForTrainingSession, useTrainingAttendanceEvidence, useTrainingSessionRegistrations,
  type TrainingSessionRegistration,
} from "@/hooks/useTrainingClasses";
import { facilityDateTimeLocalToUtcIso, toFacilityDateTimeLocal } from "@/lib/dateUtils";
import {
  formatSeatMinutes, seatMinutesBetween, summarizeSessionCredit,
  type AttendanceEvidenceLike,
} from "@/lib/trainingAttendanceCredit";

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
 *
 * Registration itself (G16.7) was the missing first step, and it is why the unrendered-hook gate
 * exists: `register_for_training_session` had a hook, so the dormant-RPC check passed, and no
 * component rendered the hook, so the roster this card manages could never be populated.
 */
export function SessionRosterCard({
  classId,
  classStatus,
  capacity,
  classDate,
  startsAt,
  endsAt,
  durationHours,
  employees,
  employeesLoading = false,
  employeesError = false,
  employeeName,
}: {
  classId: string;
  classStatus: string | null | undefined;
  capacity: number | null | undefined;
  /** `training_classes.class_date`, the fallback day when the class carries no starts_at. */
  classDate?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  /**
   * `training_classes.duration_hours` -- the figure approval credits to every attendee, whatever
   * the recorded seat time says. Shown before approval so nobody signs off hours they did not
   * intend to grant.
   */
  durationHours?: number | null;
  /** Active employees who could be registered, in display order. */
  employees: { id: string; name: string }[];
  employeesLoading?: boolean;
  employeesError?: boolean;
  employeeName: (employeeId: string) => string;
}) {
  const { toast } = useToast();
  const registrations = useTrainingSessionRegistrations(classId);
  const record = useRecordTrainingAttendance(classId);
  const approve = useApproveTrainingSessionCompletion(classId);
  const register = useRegisterForTrainingSession();

  const [openRow, setOpenRow] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("attended");
  const [typedName, setTypedName] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveReason, setApproveReason] = useState("");
  const [registering, setRegistering] = useState("");

  const rows = registrations.data ?? [];
  // Only these two states can be approved; the server refuses anything else outright. Registration
  // is gated on exactly the same two states, by the same function.
  const canApprove = classStatus === "scheduled" || classStatus === "in_progress";
  const attendedWithoutEvidence = rows.filter(
    (row) => row.registration_status === "attended" && !row.attendance_recorded_at,
  ).length;

  // The server counts `registered` and `attended` against capacity -- a withdrawal or a waitlist
  // entry does not hold a seat -- so the seats-taken figure here has to be counted the same way or
  // it will disagree with the status the registration comes back with.
  const seatsTaken = rows.filter(
    (row) => row.registration_status === "registered" || row.registration_status === "attended",
  ).length;
  const registeredIds = useMemo(() => new Set(rows.map((row) => row.employee_id)), [rows]);
  const registrable = useMemo(
    () => employees.filter((employee) => !registeredIds.has(employee.id)),
    [employees, registeredIds],
  );
  const full = capacity != null && seatsTaken >= capacity;

  // What the class was scheduled to deliver. This is the number approval credits per attendee, so
  // it is also the number the seat-time entry below is measured against.
  const scheduledHours = durationHours ?? 0;

  const attendedRegistrationIds = useMemo(
    () => rows.filter((row) => row.registration_status === "attended").map((row) => row.id),
    [rows],
  );
  const evidenceQuery = useTrainingAttendanceEvidence(attendedRegistrationIds);
  const evidenceByRegistration = useMemo(() => {
    const map = new Map<string, AttendanceEvidenceLike>();
    for (const row of evidenceQuery.data ?? []) map.set(row.registration_id, row);
    return map;
  }, [evidenceQuery.data]);
  const credit = useMemo(
    () => summarizeSessionCredit(attendedRegistrationIds, evidenceByRegistration, scheduledHours),
    [attendedRegistrationIds, evidenceByRegistration, scheduledHours],
  );

  /**
   * The scheduled window, as `<input type="datetime-local">` values in facility wall-clock time.
   *
   * Defaulting both ends to `new Date()` -- which is what this card did -- produced a check-in and
   * a check-out at the same instant on every entry, and `record_training_attendance` derives
   * `seat_minutes` from exactly that difference. Every attendance recorded through this screen was
   * therefore zero seat minutes -- credited as the class's full scheduled hours at the time, and
   * refused outright by approval since 20260906220000. Seeding from the class's own window means
   * the common case is one click and the evidence matches the class; an early departure is an
   * edit, not a re-derivation.
   */
  const defaultWindow = useMemo(() => {
    const start = startsAt
      ? toFacilityDateTimeLocal(startsAt)
      : classDate
        ? `${classDate}T09:00`
        : toFacilityDateTimeLocal(new Date());
    if (endsAt) return { start, end: toFacilityDateTimeLocal(endsAt) };
    const startMs = Date.parse(facilityDateTimeLocalToUtcIso(start));
    const end = toFacilityDateTimeLocal(new Date(startMs + scheduledHours * 3_600_000));
    return { start, end };
  }, [startsAt, endsAt, classDate, scheduledHours]);

  const openAttendance = (registrationId: string) => {
    setOpenRow(registrationId);
    setStatus("attended");
    setTypedName("");
    setCheckIn(defaultWindow.start);
    setCheckOut(defaultWindow.end);
  };

  // Recomputed from the fields as typed, so the recorder sees the seat time their entry produces
  // before they sign it rather than after approval has already credited the class.
  const draftSeatMinutes = checkIn && checkOut
    ? seatMinutesBetween(facilityDateTimeLocalToUtcIso(checkIn), facilityDateTimeLocalToUtcIso(checkOut))
    : null;
  // `no_show` legitimately has no seat time; the other two claim the person was in the room, and a
  // claim of zero (or negative) minutes in the room is not evidence of anything.
  const seatTimeRequired = status === "attended" || status === "partial";
  const draftSeatTimeInvalid = seatTimeRequired && (draftSeatMinutes === null || draftSeatMinutes <= 0);

  const submitAttendance = async (row: TrainingSessionRegistration) => {
    if (draftSeatTimeInvalid) {
      toast({
        title: "Check-out must be after check-in",
        description:
          "An attendance with no time between check-in and check-out records zero seat minutes, and approval refuses the whole session until it is corrected.",
        variant: "destructive",
      });
      return;
    }
    // A no-show has no seat time to record, and writing the scheduled window for one would put
    // hours of "attendance" behind a person who never arrived.
    const checkInAt = seatTimeRequired ? facilityDateTimeLocalToUtcIso(checkIn) : null;
    const checkOutAt = seatTimeRequired ? facilityDateTimeLocalToUtcIso(checkOut) : null;
    // `attended` is the only status the server demands a signature for, but recording one for every
    // status keeps the evidence row uniform and costs nothing.
    const attestation = `${typedName.trim()}|${row.id}|${status}|${checkInAt}|${checkOutAt}`;
    const attendee = await signatureDigest(attestation);
    const recorder = await signatureDigest(`recorder|${attestation}`);
    record.mutate(
      {
        registrationId: row.id,
        attendanceStatus: status,
        checkInAt,
        checkOutAt,
        attendeeSignatureSha256: attendee,
        recorderSignatureSha256: recorder,
        evidence: { attestedName: typedName.trim() },
      },
      {
        onSuccess: () => {
          setOpenRow(null);
          setTypedName("");
          toast({
            title: "Attendance recorded",
            description: seatTimeRequired
              ? `${formatSeatMinutes(draftSeatMinutes)} of seat time.`
              : "No seat time recorded for a no-show.",
          });
        },
        onError: (error) => toast({ title: "Attendance refused", description: errorText(error), variant: "destructive" }),
      },
    );
  };

  if (registrations.isLoading) return <Skeleton className="h-32" />;
  if (registrations.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-5 w-5" />Session roster
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QueryError
            what="session registrations"
            error={registrations.error}
            onRetry={() => void registrations.refetch()}
          />
        </CardContent>
      </Card>
    );
  }

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
        <div className="space-y-2 rounded border p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="register-employee" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Register an employee
            </Label>
            {capacity != null && (
              <Badge variant={full ? "secondary" : "outline"}>
                {seatsTaken} of {capacity} seats
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={registering} onValueChange={setRegistering} disabled={!canApprove || employeesLoading || employeesError}>
              <SelectTrigger id="register-employee" className="sm:w-72">
                <SelectValue placeholder={
                  employeesLoading
                    ? "Loading employees…"
                    : employeesError
                      ? "Could not load employees"
                      : registrable.length
                        ? "Pick an employee"
                        : "Everyone is already registered"
                } />
              </SelectTrigger>
              <SelectContent>
                {employeesLoading ? (
                  <SelectItem value="none" disabled>Loading employees…</SelectItem>
                ) : employeesError ? (
                  <SelectItem value="none" disabled>Could not load employees</SelectItem>
                ) : registrable.length === 0 ? (
                  <SelectItem value="none" disabled>Everyone is already registered</SelectItem>
                ) : (
                  registrable.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={register.isPending || !registering || !canApprove}
              title={canApprove ? undefined : `A ${classStatus ?? "class"} session is not open for registration.`}
              onClick={() => register.mutate({ classId, employeeId: registering }, {
                onSuccess: (receipt) => {
                  setRegistering("");
                  // The receipt is the point: over capacity the server silently waitlists rather
                  // than refusing, so saying only "registered" would misreport what happened.
                  toast({
                    title: receipt.status === "waitlisted"
                      ? `Waitlisted at #${receipt.waitlistPosition ?? "?"}`
                      : "Registered",
                    description: receipt.status === "waitlisted"
                      ? "The session is full. They move up automatically as seats free up."
                      : undefined,
                  });
                },
                onError: (error) => toast({ title: "Registration refused", description: errorText(error), variant: "destructive" }),
              })}
            >
              <UserPlus className="mr-1 h-4 w-4" />
              {register.isPending ? "Registering…" : "Register"}
            </Button>
          </div>
          {full && (
            <p className="text-xs text-muted-foreground">
              The session is full. Registering now adds the employee to the waitlist rather than
              refusing — the server decides, and the receipt says which happened.
            </p>
          )}
        </div>

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
                      <Button size="sm" variant="outline" onClick={() => openAttendance(row.id)}>
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
                  {/* Hidden for a no-show: there is no seat time to enter, and the submit path
                      sends nulls rather than the scheduled window for one. */}
                  {seatTimeRequired && (
                  <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`att-in-${row.id}`}>Checked in</Label>
                      <Input
                        id={`att-in-${row.id}`}
                        type="datetime-local"
                        value={checkIn}
                        onChange={(event) => setCheckIn(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`att-out-${row.id}`}>Checked out</Label>
                      <Input
                        id={`att-out-${row.id}`}
                        type="datetime-local"
                        value={checkOut}
                        onChange={(event) => setCheckOut(event.target.value)}
                      />
                    </div>
                  </div>
                  <p
                    className={`text-xs ${draftSeatTimeInvalid ? "text-destructive" : "text-muted-foreground"}`}
                    role="status"
                    aria-live="polite"
                  >
                    {draftSeatTimeInvalid
                      ? "Check-out must be after check-in. A zero-length attendance records no seat time, and approval would still credit the full scheduled hours for it."
                      : `Seat time ${formatSeatMinutes(draftSeatMinutes)}${
                        scheduledHours > 0 ? ` · approval credits ${scheduledHours} h regardless` : ""
                      }.`}
                  </p>
                  </>
                  )}
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
                      disabled={record.isPending || typedName.trim().length < 2 || draftSeatTimeInvalid}
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
            {/* What approval is about to write, before it writes it. Since 20260906220000
                approve_training_session_completion credits each attendee their own recorded seat
                time, capped by training_classes.duration_hours -- so this preview is per-attendee
                arithmetic, not one figure times a head count. */}
            {/* No numeric preview when the evidence did not load. The figures would be the
                scheduled-hours fallback for every attendee -- which is the exact promise J84 was
                about, arriving again through the error path -- while approval reads the stored
                seat_minutes and writes something smaller. A sentence saying the credit cannot be
                previewed is worth more than a number that is wrong. */}
            {evidenceQuery.isError ? (
              <div className="rounded border bg-muted/30 p-2 text-xs">
                <p className="font-medium text-foreground">
                  Recorded seat times could not be loaded, so what approval will credit cannot be
                  shown here.
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  Approval credits each attendee their recorded seat time, capped at the class's
                  scheduled {credit.scheduledHours} h. Reload before approving if you need to see
                  the figures first.
                </p>
              </div>
            ) : (
            <div className="rounded border bg-muted/30 p-2 text-xs">
              <p className="font-medium text-foreground">
                {credit.hoursPerAttendee !== null ? (
                  <>
                    Approval will credit {credit.hoursPerAttendee} h to each of {credit.attendedCount}{" "}
                    attendee{credit.attendedCount === 1 ? "" : "s"} — {credit.totalCreditedHours} h in total.
                  </>
                ) : (
                  <>
                    Approval will credit {credit.totalCreditedHours} h in total across{" "}
                    {credit.attendedCount} attendee{credit.attendedCount === 1 ? "" : "s"}, each from
                    their own recorded seat time.
                  </>
                )}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                Each attendee is credited the seat time recorded for them, capped at the class's
                scheduled {credit.scheduledHours} h.
              </p>
            </div>
            )}
            {/* Every flagged row is derived from the same evidence, so with none loaded this list
                would be a full roster of "unrecorded" that says nothing about the attendance. */}
            {!evidenceQuery.isError && credit.flagged.length > 0 && (
              <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">
                    {credit.flagged.length} attendance
                    {credit.flagged.length === 1 ? " needs" : "s need"} a look before approval.
                  </p>
                  <ul className="space-y-0.5">
                    {credit.flagged.map((row) => {
                      const registration = rows.find((r) => r.id === row.registrationId);
                      return (
                        <li key={row.registrationId}>
                          {registration ? employeeName(registration.employee_id) : row.registrationId.slice(0, 8)}
                          {" · "}
                          {row.issue === "unrecorded"
                            ? "no check-in/check-out recorded"
                            : row.issue === "zero_length"
                              ? "checked out at or before check-in (no seat time)"
                              : `${formatSeatMinutes(row.seatMinutes)} of seat time`}
                          {row.issue === "short"
                            ? ` · credited ${row.creditedHours} h of the scheduled ${credit.scheduledHours} h`
                            : " · approval will refuse until this is corrected"}
                        </li>
                      );
                    })}
                  </ul>
                  <p>
                    A short attendance is credited what it records, so approving one is a decision
                    about the person's hours, not about the class's. An unrecorded or zero-length
                    one has to be corrected: approval refuses the whole session over it. These
                    hours count toward the annual training totals a surveyor reads.
                  </p>
                </div>
              </div>
            )}
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
