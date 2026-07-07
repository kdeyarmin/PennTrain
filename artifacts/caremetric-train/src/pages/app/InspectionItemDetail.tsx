import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetInspectionItem, useUpdateInspectionItem } from "@/hooks/useInspectionItems";
import { useListInspectionEvents, useCreateInspectionEvent } from "@/hooks/useInspectionEvents";
import { useListCorrectiveActions, useUpdateCorrectiveAction } from "@/hooks/useCorrectiveActions";
import type { InspectionEvent } from "@/hooks/useInspectionEvents";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListViolationsBySourceInspectionEvents } from "@/hooks/useViolations";
import { CorrectiveActionForm, CorrectiveActionStatusBadge } from "@/components/CorrectiveActionForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Flame, ClipboardList, Plus, Check, Printer, AlertTriangle, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn, humanize } from "@/lib/utils";

const SHIFT_OPTIONS = ["day", "evening", "overnight"] as const;

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function ResultBadge({ result }: { result: string }) {
  const className =
    result === "pass" ? "bg-success text-success-foreground hover:bg-success/80"
    : result === "fail" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : "bg-warning text-warning-foreground hover:bg-warning/80"; // deficiency_noted
  return <Badge className={className} variant="outline">{humanize(result)}</Badge>;
}

// Small inline error shown under a required field once a submit attempt has flagged it empty --
// replaces a single generic toast that gave no indication of which of the fire-drill dialog's 6+
// required fields was the problem.
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive mt-1">{message}</p>;
}

const errorFieldClass = (hasError: string | undefined) => cn(hasError && "border-destructive focus-visible:ring-destructive");

function EventCorrectiveActions({ event, canManage }: { event: InspectionEvent; canManage: boolean }) {
  const { data: actions } = useListCorrectiveActions({ inspectionEventId: event.id });
  const { mutate: updateAction } = useUpdateCorrectiveAction();

  return (
    <div className="mt-2 pl-4 border-l-2 space-y-2">
      {actions?.map((ca) => (
        <div key={ca.id} className="flex items-center justify-between text-xs">
          <span>{ca.description} — due {ca.due_date}</span>
          <div className="flex items-center gap-1.5">
            <CorrectiveActionStatusBadge status={ca.status} />
            {canManage && ca.status !== "completed" && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateAction({ id: ca.id, status: "completed", completed_date: new Date().toISOString().slice(0, 10) })}>
                <Check className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      ))}
      {canManage && (
        <CorrectiveActionForm
          parent={{ organizationId: event.organization_id, facilityId: event.facility_id, inspectionEventId: event.id }}
          size="sm"
        />
      )}
    </div>
  );
}

export default function InspectionItemDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Mounted at both /app/inspections/:id (org roles) and /admin/inspections/:id
  // (platform_admin, reached via Alerts deep links); basePath keeps back-navigation correct.
  const basePath = user?.role === "platform_admin" ? "/admin/inspections" : "/app/inspections";
  const canManage = ["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user?.role ?? "");
  // Narrower than canManage above: dhs_violations_insert RLS and Violations.tsx's own "Record
  // Violation" gate exclude trainer and platform_admin, so a "Create Violation" action shown to
  // either role here would be a dead end (RLS rejection, or a route redirect for platform_admin).
  const canCreateViolation = ["org_admin", "facility_manager"].includes(user?.role ?? "");
  // Mirrors App.tsx's VIOLATION_ROLES -- /app/violations/:id redirects anyone outside this set
  // (notably trainer and platform_admin, both of whom can reach this page), so a "View Violation"
  // link shown to either would be a dead end too.
  const canViewViolation = ["org_admin", "facility_manager", "auditor"].includes(user?.role ?? "");

  const { data: item, isLoading } = useGetInspectionItem(id);
  const { data: facilities } = useListFacilities();
  const { data: events, isLoading: eventsLoading } = useListInspectionEvents(id);
  const { mutate: updateItem } = useUpdateInspectionItem();
  const { mutate: createEvent, isPending: creatingEvent } = useCreateInspectionEvent();
  const nonPassEventIds = (events ?? []).filter((e) => e.result !== "pass").map((e) => e.id);
  const { data: sourcedViolations } = useListViolationsBySourceInspectionEvents(nonPassEventIds);
  const violationByEventId = new Map((sourcedViolations ?? []).map((v) => [v.source_inspection_event_id, v]));

  const [showEventForm, setShowEventForm] = useState(false);
  const [performedDate, setPerformedDate] = useState(new Date().toISOString().slice(0, 10));
  const [performedBy, setPerformedBy] = useState("");
  const [result, setResult] = useState<"pass" | "fail" | "deficiency_noted">("pass");
  const [deficiencyNotes, setDeficiencyNotes] = useState("");

  // Fire-drill-specific fields -- the nine-field record 55 Pa. Code 2600.132/2800.132 requires.
  const [drillTime, setDrillTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [exitRouteUsed, setExitRouteUsed] = useState("");
  const [residentsPresent, setResidentsPresent] = useState("");
  const [residentsEvacuated, setResidentsEvacuated] = useState("");
  const [staffParticipating, setStaffParticipating] = useState("");
  const [alarmOperative, setAlarmOperative] = useState("yes");
  const [problemsEncountered, setProblemsEncountered] = useState("");
  const [shift, setShift] = useState<(typeof SHIFT_OPTIONS)[number]>("day");
  const [isSleepingHoursDrill, setIsSleepingHoursDrill] = useState(false);
  // Only shown once a submit attempt has actually failed -- an untouched, freshly-opened dialog
  // shouldn't greet the user with a wall of red borders.
  const [showValidation, setShowValidation] = useState(false);

  const facilityName = facilities?.find((f) => f.id === item?.facility_id)?.name;
  const isFireDrill = item?.item_type === "fire_drill_program";

  // Recomputed from current field values on every render (cheap -- a handful of string checks)
  // rather than tracked as its own state, so an error can never go stale relative to what's
  // actually typed in the field it describes.
  const fieldErrors = {
    performedBy: !performedBy.trim() ? "Required" : undefined,
    drillTime: isFireDrill && !drillTime ? "Required" : undefined,
    exitRouteUsed: isFireDrill && !exitRouteUsed.trim() ? "Required" : undefined,
    residentsPresent: isFireDrill && !residentsPresent.trim() ? "Required" : undefined,
    residentsEvacuated: isFireDrill && !residentsEvacuated.trim() ? "Required" : undefined,
    staffParticipating: isFireDrill && !staffParticipating.trim() ? "Required" : undefined,
    problemsEncountered: isFireDrill && !problemsEncountered.trim() ? "Required" : undefined,
  };

  const resetEventForm = () => {
    setPerformedBy(""); setDeficiencyNotes(""); setResult("pass");
    setDrillTime(""); setDurationMinutes(""); setDurationSeconds(""); setExitRouteUsed("");
    setResidentsPresent(""); setResidentsEvacuated(""); setStaffParticipating("");
    setAlarmOperative("yes"); setProblemsEncountered(""); setShift("day"); setIsSleepingHoursDrill(false);
    setShowValidation(false);
  };

  const handleLogEvent = () => {
    if (!item) return;
    if (Object.values(fieldErrors).some(Boolean)) {
      setShowValidation(true);
      toast({ title: "Please fill in the highlighted fields", variant: "destructive" });
      return;
    }
    const totalSeconds = durationMinutes.trim() || durationSeconds.trim()
      ? (Number(durationMinutes || 0) * 60) + Number(durationSeconds || 0)
      : null;
    createEvent(
      {
        inspection_item_id: item.id, performed_date: performedDate, performed_by: performedBy.trim(),
        result, deficiency_notes: result !== "pass" ? (deficiencyNotes || null) : null,
        follow_up_required: result !== "pass",
        organization_id: item.organization_id, facility_id: item.facility_id,
        ...(isFireDrill ? {
          drill_time: drillTime || null,
          evacuation_duration_seconds: totalSeconds,
          exit_route_used: exitRouteUsed.trim() || null,
          residents_present_count: residentsPresent.trim() ? Number(residentsPresent) : null,
          residents_evacuated_count: residentsEvacuated.trim() ? Number(residentsEvacuated) : null,
          staff_participating_count: staffParticipating.trim() ? Number(staffParticipating) : null,
          alarm_or_detector_operative: alarmOperative === "yes",
          problems_encountered: problemsEncountered.trim() || null,
          shift,
          is_sleeping_hours_drill: isSleepingHoursDrill,
        } : {}),
      },
      {
        onSuccess: () => { toast({ title: "Inspection logged" }); setShowEventForm(false); resetEventForm(); },
        onError: (e: Error) => toast({ title: "Failed to log inspection", description: e.message, variant: "destructive" }),
      },
    );
  };

  // Rotation hint: DHS expects drills to vary across shifts and exit routes over time, not
  // repeat the same one every month -- flag (not block) when the two most recent drills match.
  const fireDrillEvents = isFireDrill ? (events ?? []).filter((e) => e.shift) : [];
  const repeatsLastShift = fireDrillEvents.length >= 2 && fireDrillEvents[0].shift === fireDrillEvents[1].shift;
  const repeatsLastExit = fireDrillEvents.length >= 2
    && !!fireDrillEvents[0].exit_route_used
    && fireDrillEvents[0].exit_route_used === fireDrillEvents[1].exit_route_used;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Inspection item not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={basePath}>Back to Inspections</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={basePath}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap print:hidden">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Flame className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{item.label}</h1>
            <p className="text-muted-foreground">{facilityName} · {item.item_type.replace(/_/g, " ")}</p>
            <div className="mt-2"><StatusBadge status={item.status} type="training" /></div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isFireDrill && fireDrillEvents.length > 0 && (
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> Print Fire Drill Record
            </Button>
          )}
          {canManage && <Button onClick={() => setShowEventForm(true)}><Plus className="mr-2 h-4 w-4" /> Log Inspection</Button>}
        </div>
      </div>

      {isFireDrill && (repeatsLastShift || repeatsLastExit) && (
        <div className="print:hidden flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <p>
            The two most recent drills {repeatsLastShift && "used the same shift"}
            {repeatsLastShift && repeatsLastExit && " and "}
            {repeatsLastExit && "used the same exit route"}. DHS expects drills to rotate across
            shifts and exit routes over time rather than repeat the same conditions.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:hidden">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Interval</p><p className="font-semibold">Every {item.inspection_interval_days} days</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Last Inspected</p><p className="font-semibold">{item.last_inspected_date ?? "Never"}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Next Due</p><p className="font-semibold">{item.next_due_date ?? "—"}</p></CardContent></Card>
      </div>

      {canManage && (
        <Card className="print:hidden">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Notes</Label>
              <Textarea
                defaultValue={item.notes ?? ""}
                onBlur={(e) => { if (e.target.value !== (item.notes ?? "")) updateItem({ id: item.id, notes: e.target.value || null }); }}
                placeholder="Optional notes"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> Inspection History</CardTitle>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !events?.length ? (
            <p className="text-sm text-muted-foreground">No inspections logged yet.</p>
          ) : (
            <div className="space-y-3">
              {events.map((e) => (
                <div key={e.id} className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">
                        {e.performed_date}{e.drill_time ? ` ${e.drill_time}` : ""} — {e.performed_by}
                      </p>
                      {isFireDrill && (e.shift || e.exit_route_used) && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {e.shift ? humanize(e.shift) + " shift" : ""}
                          {e.shift && e.exit_route_used ? " · " : ""}
                          {e.exit_route_used ? `Exit: ${e.exit_route_used}` : ""}
                          {e.is_sleeping_hours_drill ? " · Sleeping-hours drill" : ""}
                          {e.evacuation_duration_seconds != null ? ` · ${formatDuration(e.evacuation_duration_seconds)}` : ""}
                        </p>
                      )}
                      {e.deficiency_notes && <p className="text-xs text-muted-foreground mt-1">{e.deficiency_notes}</p>}
                    </div>
                    <ResultBadge result={e.result} />
                  </div>
                  {e.result !== "pass" && (
                    <>
                      <EventCorrectiveActions event={e} canManage={canManage} />
                      <div className="mt-2 pl-4">
                        {violationByEventId.has(e.id) ? (
                          canViewViolation ? (
                            <Link href={`/app/violations/${violationByEventId.get(e.id)!.id}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                              <ShieldAlert className="h-3 w-3" /> View Violation
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <ShieldAlert className="h-3 w-3" /> Violation recorded
                            </span>
                          )
                        ) : canCreateViolation && (
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                            onClick={() => {
                              const params = new URLSearchParams({
                                action: "add",
                                facilityId: item.facility_id,
                                inspectionDate: e.performed_date,
                                description: `${item.label} — ${humanize(e.result)}${e.deficiency_notes ? `: ${e.deficiency_notes}` : ""}`,
                                sourceEventId: e.id,
                              });
                              if (item.citation_topic_id) params.set("citationTopicId", item.citation_topic_id);
                              navigate(`/app/violations?${params.toString()}`);
                            }}
                          >
                            <ShieldAlert className="h-3 w-3" /> Create Violation from this Finding
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isFireDrill && fireDrillEvents.length > 0 && (
        <div className="hidden print:block">
          <h2 className="text-lg font-bold mb-1">Fire Drill Record — {item.label}</h2>
          <p className="text-sm mb-4">{facilityName}</p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-black">
                {["Date", "Time", "Shift", "Duration", "Exit Route", "Residents Present", "Residents Evacuated", "Staff Participating", "Alarm/Detector Operative", "Problems Encountered"].map((h) => (
                  <th key={h} className="text-left p-1 border border-black">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(events ?? []).filter((e) => e.shift).map((e) => (
                <tr key={e.id}>
                  <td className="p-1 border border-black">{e.performed_date}</td>
                  <td className="p-1 border border-black">{e.drill_time ?? "—"}</td>
                  <td className="p-1 border border-black">{e.shift ? humanize(e.shift) : "—"}{e.is_sleeping_hours_drill ? " (sleeping hours)" : ""}</td>
                  <td className="p-1 border border-black">{formatDuration(e.evacuation_duration_seconds)}</td>
                  <td className="p-1 border border-black">{e.exit_route_used ?? "—"}</td>
                  <td className="p-1 border border-black">{e.residents_present_count ?? "—"}</td>
                  <td className="p-1 border border-black">{e.residents_evacuated_count ?? "—"}</td>
                  <td className="p-1 border border-black">{e.staff_participating_count ?? "—"}</td>
                  <td className="p-1 border border-black">{e.alarm_or_detector_operative == null ? "—" : e.alarm_or_detector_operative ? "Yes" : "No"}</td>
                  <td className="p-1 border border-black">{e.problems_encountered || "None noted"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showEventForm} onOpenChange={(o) => { if (!o) { setShowEventForm(false); setShowValidation(false); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Log Inspection</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Date *</Label>
              <Input type="date" value={performedDate} onChange={(e) => setPerformedDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Performed By *</Label>
              <Input
                value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} placeholder="Staff name or vendor"
                className={cn("h-9", showValidation && errorFieldClass(fieldErrors.performedBy))}
              />
              {showValidation && <FieldError message={fieldErrors.performedBy} />}
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Result *</Label>
              <Select value={result} onValueChange={(v) => setResult(v as typeof result)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["pass", "fail", "deficiency_noted"].map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {result !== "pass" && (
              <div className="col-span-full space-y-1.5">
                <Label className="text-[13px]">Deficiency Notes</Label>
                <Textarea value={deficiencyNotes} onChange={(e) => setDeficiencyNotes(e.target.value)} placeholder="What was found" />
              </div>
            )}

            {isFireDrill && (
              <>
                <div className="col-span-2 pt-2 border-t">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">DHS Fire Drill Record Fields</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Time</Label>
                  <Input
                    type="time" value={drillTime} onChange={(e) => setDrillTime(e.target.value)}
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.drillTime))}
                  />
                  {showValidation && <FieldError message={fieldErrors.drillTime} />}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Shift</Label>
                  <Select value={shift} onValueChange={(v) => setShift(v as typeof shift)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SHIFT_OPTIONS.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Evacuation Duration (min)</Label>
                  <Input type="number" min={0} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Duration (sec)</Label>
                  <Input type="number" min={0} max={59} value={durationSeconds} onChange={(e) => setDurationSeconds(e.target.value)} className="h-9" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-[13px]">Exit Route Used</Label>
                  <Input
                    value={exitRouteUsed} onChange={(e) => setExitRouteUsed(e.target.value)} placeholder="e.g. East stairwell to rear parking lot"
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.exitRouteUsed))}
                  />
                  {showValidation && <FieldError message={fieldErrors.exitRouteUsed} />}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Residents Present</Label>
                  <Input
                    type="number" min={0} value={residentsPresent} onChange={(e) => setResidentsPresent(e.target.value)}
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.residentsPresent))}
                  />
                  {showValidation && <FieldError message={fieldErrors.residentsPresent} />}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Residents Evacuated</Label>
                  <Input
                    type="number" min={0} value={residentsEvacuated} onChange={(e) => setResidentsEvacuated(e.target.value)}
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.residentsEvacuated))}
                  />
                  {showValidation && <FieldError message={fieldErrors.residentsEvacuated} />}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Staff Participating</Label>
                  <Input
                    type="number" min={0} value={staffParticipating} onChange={(e) => setStaffParticipating(e.target.value)}
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.staffParticipating))}
                  />
                  {showValidation && <FieldError message={fieldErrors.staffParticipating} />}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Alarm/Detector Operative</Label>
                  <Select value={alarmOperative} onValueChange={setAlarmOperative}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox" id="sleeping-hours" checked={isSleepingHoursDrill}
                    onChange={(e) => setIsSleepingHoursDrill(e.target.checked)} className="h-4 w-4"
                  />
                  <Label htmlFor="sleeping-hours" className="text-[13px] cursor-pointer">
                    This is the sleeping-hours drill (required every 6 months)
                  </Label>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-[13px]">Problems Encountered</Label>
                  <Textarea
                    value={problemsEncountered} onChange={(e) => setProblemsEncountered(e.target.value)}
                    placeholder="Required field on the DHS form -- enter &quot;None&quot; if the drill went smoothly"
                    className={showValidation ? errorFieldClass(fieldErrors.problemsEncountered) : undefined}
                  />
                  {showValidation && <FieldError message={fieldErrors.problemsEncountered} />}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEventForm(false); setShowValidation(false); }}>Cancel</Button>
            <Button onClick={handleLogEvent} disabled={creatingEvent} className="shadow-sm">
              {creatingEvent ? "Saving..." : "Log Inspection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
