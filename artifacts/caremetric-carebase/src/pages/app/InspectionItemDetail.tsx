import { useId, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetInspectionItem, useUpdateInspectionItem, useListInspectionItems } from "@/hooks/useInspectionItems";
import { useListInspectionEvents, useCreateInspectionEvent } from "@/hooks/useInspectionEvents";
import { useListCorrectiveActions, type CorrectiveAction } from "@/hooks/useCorrectiveActions";
import type { InspectionEvent } from "@/hooks/useInspectionEvents";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListViolationsBySourceInspectionEvents } from "@/hooks/useViolations";
import { useListWorkOrders } from "@/hooks/useWorkOrders";
import { CorrectiveActionForm, CorrectiveActionStatusBadge } from "@/components/CorrectiveActionForm";
import { VerifyCorrectiveActionDialog } from "@/components/incidents/VerifyCorrectiveActionDialog";
import { MaintenanceQrCode } from "@/components/maintenance/MaintenanceQrCode";
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
import { QueryError } from "@/components/QueryState";
import { ArrowLeft, Flame, ClipboardList, Plus, Check, Printer, AlertTriangle, ShieldAlert, Wrench } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn, humanize } from "@/lib/utils";
import { facilityToday } from "@/lib/dateUtils";
import { evacuationSeconds, fireDrillRecordErrors, type FireDrillRecordErrors } from "@/lib/fireDrillRecord";
import { INSPECTION_RULES, evacuationFinding, isSleepingHours } from "@/lib/inspectionRules";
import { PCH_ALR_ONLY_FACILITY_TYPES, type FacilityType } from "@/lib/facilityTypes";

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
  // BACKLOG J74. This tick used to write `{status: "completed", completed_date}` straight to the
  // table for every action whose status was not already "completed" -- cancelled included. So an
  // action somebody had cancelled could be resolved as done from here, and it was the one of the
  // three corrective-action surfaces that skipped verify_corrective_action, which has refused a
  // cancelled action since 20260906090000 and is what writes the verification the incident and
  // violation pages require. It now uses the same dialog and the same RPC as those two, and the
  // control is not offered for a cancelled action at all (20260906270000 also refuses the
  // transition on the table, so no other client can take the shortcut either).
  const [verifyingAction, setVerifyingAction] = useState<CorrectiveAction | null>(null);

  return (
    <div className="mt-2 pl-4 border-l-2 space-y-2">
      {actions?.map((ca) => (
        <div key={ca.id} className="flex items-center justify-between text-xs">
          <span>{ca.description} — due {ca.due_date}</span>
          <div className="flex items-center gap-1.5">
            <CorrectiveActionStatusBadge status={ca.status} />
            {canManage && ca.status !== "cancelled" && (ca.status !== "completed" || !ca.verification_notes?.trim()) && (
              <Button
                variant="ghost" size="icon" className="h-6 w-6"
                onClick={() => setVerifyingAction(ca)}
                aria-label={ca.status === "completed" ? "Verify corrective action" : "Complete and verify corrective action"}
                title={ca.status === "completed" ? "Verify this completed action" : "Complete and verify this action"}
              >
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
      <VerifyCorrectiveActionDialog
        action={verifyingAction}
        open={verifyingAction !== null}
        onOpenChange={(open) => { if (!open) setVerifyingAction(null); }}
      />
    </div>
  );
}

export default function InspectionItemDetail() {
  const __fieldIds = useId();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Platform-admin inspection details are reachable via multiple entry points (e.g. Alerts, Audit Log).
  // There is no /admin/inspections list route, so send "Back" to a known valid page (currently Alerts).
  const backDestination = user?.role === "platform_admin"
    ? { href: "/admin/alerts", label: "Alerts" }
    : { href: "/app/inspections", label: "Inspections" };
  const canManage = ["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user?.role ?? "");
  // Narrower than canManage above: dhs_violations_insert RLS and Violations.tsx's own "Record
  // Violation" gate exclude trainer and platform_admin, so a "Create Violation" action shown to
  // either role here would be a dead end (RLS rejection, or a route redirect for platform_admin).
  const canCreateViolation = ["org_admin", "facility_manager"].includes(user?.role ?? "");
  // Mirrors App.tsx's VIOLATION_ROLES -- /app/violations/:id redirects anyone outside this set
  // (notably trainer and platform_admin, both of whom can reach this page), so a "View Violation"
  // link shown to either would be a dead end too.
  const canViewViolation = ["org_admin", "facility_manager", "auditor"].includes(user?.role ?? "");

  const { data: item, isLoading, isError, error, refetch } = useGetInspectionItem(id);
  const { data: facilities } = useListFacilities();
  const {
    data: events,
    isLoading: eventsLoading,
    isError: eventsError,
    error: eventsErrorDetail,
    refetch: refetchEvents,
  } = useListInspectionEvents(id);
  const {
    data: workOrders,
    isLoading: workOrdersLoading,
    isError: workOrdersError,
    error: workOrdersErrorDetail,
    refetch: refetchWorkOrders,
  } = useListWorkOrders({ inspectionItemId: id });
  const { mutate: updateItem } = useUpdateInspectionItem();
  const { mutate: createEvent, isPending: creatingEvent } = useCreateInspectionEvent();
  const nonPassEventIds = (events ?? []).filter((e) => e.result !== "pass").map((e) => e.id);
  const violationLookupEventIds = (user?.role === "platform_admin" || canCreateViolation || canViewViolation) ? nonPassEventIds : [];
  const { data: sourcedViolations } = useListViolationsBySourceInspectionEvents(violationLookupEventIds);
  const violationByEventId = new Map((sourcedViolations ?? []).map((v) => [v.source_inspection_event_id, v]));

  const [showEventForm, setShowEventForm] = useState(false);
  const [performedDate, setPerformedDate] = useState(facilityToday());
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
  const [alarmOperative, setAlarmOperative] = useState("");
  const [alarmSounded, setAlarmSounded] = useState("");
  const [blockedRoute, setBlockedRoute] = useState("");
  const [evacuationException, setEvacuationException] = useState("");
  const [expertName, setExpertName] = useState("");
  const [expertQualification, setExpertQualification] = useState("");
  const [submittedDate, setSubmittedDate] = useState("");
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [testedAlarmIds, setTestedAlarmIds] = useState<string[]>([]);
  const [problemsEncountered, setProblemsEncountered] = useState("");
  const [shift, setShift] = useState<(typeof SHIFT_OPTIONS)[number]>("day");
  const [isSleepingHoursDrill, setIsSleepingHoursDrill] = useState(false);
  // Only shown once a submit attempt has actually failed -- an untouched, freshly-opened dialog
  // shouldn't greet the user with a wall of red borders.
  const [showValidation, setShowValidation] = useState(false);

  const facility = facilities?.find((f) => f.id === item?.facility_id);
  const facilityName = facility?.name;
  const isFireDrill = item?.item_type === "fire_drill_program" || item?.item_type === "fire_safety_expert_inspection";
  const { data: equipmentItems, isError: equipmentError } = useListInspectionItems(
    { facilityId: item?.facility_id, itemKind: "equipment", isActive: true },
    { enabled: isFireDrill && !!item?.facility_id },
  );
  const alarmItems = equipmentItems?.filter((candidate) => ["smoke_detector", "fire_alarm_system"].includes(candidate.item_type)) ?? [];
  const needsExpert = ["fire_extinguisher", "fire_safety_expert_inspection", "wood_coal_stove_approval", "evacuation_time_letter"].includes(item?.item_type ?? "");
  const isPlanReview = item?.item_type === "emergency_prep_plan_review";
  const needsEvidence = !!INSPECTION_RULES[item?.item_type ?? ""] && !isFireDrill;
  const finding = isFireDrill ? evacuationFinding({ seconds: evacuationSeconds(durationMinutes, durationSeconds), limit: item?.evacuation_limit_seconds ?? 150,
    present: residentsPresent ? Number(residentsPresent) : null, evacuated: residentsEvacuated ? Number(residentsEvacuated) : null,
    exception: evacuationException, alarmSounded: alarmSounded ? alarmSounded === "yes" : null, alarmOperative: alarmOperative ? alarmOperative === "yes" : null }) : null;
  // The sleeping-hours schedule the database derives from a fire drill program. It has no events of
  // its own -- it reads the program's, filtered to the drills marked as sleeping-hours -- so there
  // is nothing to log here and the database refuses an event against it outright.
  const derivedFromId = item?.derived_from_inspection_item_id ?? null;
  const cadenceLabel = item?.item_type === "fire_drill_program"
    ? "Every calendar month"
    : item?.item_type === "sleeping_hours_fire_drill"
      ? "Every 6 months"
      : `Every ${item?.inspection_interval_days} days`;

  // Recomputed from current field values on every render (cheap -- a handful of string checks)
  // rather than tracked as its own state, so an error can never go stale relative to what's
  // actually typed in the field it describes.
  const drillErrors: FireDrillRecordErrors = isFireDrill
    ? fireDrillRecordErrors({
      drillTime, durationMinutes, durationSeconds, exitRouteUsed, residentsPresent,
      residentsEvacuated, staffParticipating, problemsEncountered,
    }, result !== "pass")
    : {};
  const fieldErrors = {
    performedBy: !performedBy.trim() ? "Required" : undefined,
    alarm: isFireDrill && (!alarmOperative || !alarmSounded) ? "Record whether the alarm sounded and was operative" : undefined,
    sleeping: isFireDrill && isSleepingHoursDrill && !isSleepingHours(drillTime, item?.sleeping_hours_start, item?.sleeping_hours_end) ? "Drill time is outside the documented sleeping-hours window" : undefined,
    expert: needsExpert && (!expertName.trim() || !expertQualification.trim()) ? "Record the fire safety expert and qualification" : undefined,
    submission: isPlanReview && result === "pass" && !submittedDate ? "Record the submission date to the local emergency management agency" : undefined,
    evidence: needsEvidence && result === "pass" && !evidenceNotes.trim() ? "Record the supporting evidence" : undefined,
    ...drillErrors,
  };

  const resetEventForm = () => {
    setPerformedBy(""); setDeficiencyNotes(""); setResult("pass");
    setDrillTime(""); setDurationMinutes(""); setDurationSeconds(""); setExitRouteUsed("");
    setResidentsPresent(""); setResidentsEvacuated(""); setStaffParticipating("");
    setAlarmOperative(""); setAlarmSounded(""); setBlockedRoute(""); setEvacuationException("");
    setExpertName(""); setExpertQualification(""); setSubmittedDate(""); setEvidenceNotes("");
    setTestedAlarmIds([]);
    setProblemsEncountered(""); setShift("day"); setIsSleepingHoursDrill(false);
    setShowValidation(false);
  };

  const handleLogEvent = () => {
    if (!item) return;
    if (Object.values(fieldErrors).some(Boolean)) {
      setShowValidation(true);
      toast({ title: "Please fill in the highlighted fields", variant: "destructive" });
      return;
    }
    const totalSeconds = evacuationSeconds(durationMinutes, durationSeconds);
    createEvent(
      {
        inspection_item_id: item.id, performed_date: performedDate, performed_by: performedBy.trim(),
        result: finding && result === "pass" ? "deficiency_noted" : result,
        deficiency_notes: [deficiencyNotes, finding].filter(Boolean).join("\n") || null,
        follow_up_required: result !== "pass" || !!finding,
        notes: evidenceNotes.trim() || null,
        fire_safety_expert_name: expertName.trim() || null,
        fire_safety_expert_qualification: expertQualification.trim() || null,
        submitted_to_agency_at: submittedDate || null,
        organization_id: item.organization_id, facility_id: item.facility_id,
        ...(isFireDrill ? {
          drill_time: drillTime || null,
          evacuation_duration_seconds: totalSeconds,
          exit_route_used: exitRouteUsed.trim() || null,
          residents_present_count: residentsPresent.trim() ? Number(residentsPresent) : null,
          residents_evacuated_count: residentsEvacuated.trim() ? Number(residentsEvacuated) : null,
          staff_participating_count: staffParticipating.trim() ? Number(staffParticipating) : null,
          alarm_or_detector_operative: alarmOperative === "yes",
          alarm_sounded: alarmSounded === "yes",
          blocked_exit_route: blockedRoute.trim() || null,
          evacuation_exception: evacuationException.trim() || null,
          tested_alarm_item_ids: testedAlarmIds,
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

  if (isError) {
    return <QueryError what="this inspection item" error={error} onRetry={() => void refetch()} />;
  }

  if (!item) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Inspection item not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={backDestination.href}>Back to {backDestination.label}</Link>
        </Button>
      </div>
    );
  }

  if (!facility || !PCH_ALR_ONLY_FACILITY_TYPES.includes(facility.facility_type as FacilityType)) {
    return <div className="space-y-4"><h1>PA inspection workspace</h1><p>This workflow covers Personal Care Homes under Chapter 2600 and Assisted Living Facilities under Chapter 2800. It does not assess other facility types.</p><Button asChild variant="outline"><Link href={backDestination.href}>Back to {backDestination.label}</Link></Button></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={backDestination.href}><ArrowLeft className="mr-2 h-4 w-4" /> Back to {backDestination.label}</Link>
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
            <div className="mt-2">{isFireDrill && <span className="text-xs mr-2">Schedule status</span>}<StatusBadge status={item.status} type="training" /></div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isFireDrill && fireDrillEvents.length > 0 && (
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> Print Fire Drill Record
            </Button>
          )}
          {canManage && !derivedFromId && <Button asChild variant="outline"><Link href={`/app/maintenance?action=add&assetId=${item.id}`}><Wrench className="mr-2 h-4 w-4" /> New Work Order</Link></Button>}
          {canManage && !derivedFromId && <Button onClick={() => { resetEventForm(); setShowEventForm(true); }}><Plus className="mr-2 h-4 w-4" /> Log Inspection</Button>}
          {derivedFromId && (
            <Button asChild variant="outline">
              <Link href={`/app/inspections/${derivedFromId}`}>Open the fire drill program</Link>
            </Button>
          )}
        </div>
      </div>

      {isFireDrill && events?.some((event) => event.evacuation_time_exceeded) && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <strong>Evacuation-time findings remain in the record.</strong> {events.filter((event) => event.evacuation_time_exceeded).map((event) => event.performed_date).join(", ")}. A later successful drill advances the schedule but does not erase a breach of the maximum evacuation time (§132(d)). Review the corrective action with each affected drill below.
      </div>}

      {derivedFromId && (
        <div className="print:hidden flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p>
            This schedule is derived from the fire drill program: 55 Pa. Code 2600.132/2800.132
            require a drill held during sleeping hours at least every six months. Log the drill on
            the program itself and tick “This is the sleeping-hours drill” — it will roll this date
            forward.
          </p>
        </div>
      )}

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
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Interval</p><p className="font-semibold">{cadenceLabel}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Last Inspected</p><p className="font-semibold">{item.last_inspected_date ?? "Never"}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Next Due</p><p className="font-semibold">{item.next_due_date ?? "—"}</p></CardContent></Card>
      </div>

      {canManage && (
        <Card className="print:hidden">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-notes`} className="text-[13px]">Notes</Label>
              <Textarea id={`${__fieldIds}-notes`}
                defaultValue={item.notes ?? ""}
                onBlur={(e) => {
                  if (e.target.value === (item.notes ?? "")) return;
                  updateItem(
                    { id: item.id, notes: e.target.value || null },
                    {
                      onError: (err: Error) => toast({ title: "Couldn't save notes", description: err.message, variant: "destructive" }),
                    },
                  );
                }}
                placeholder="Optional notes"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] print:hidden">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Environmental Work Orders</CardTitle></CardHeader>
          <CardContent>
            {workOrdersError ? (
              <QueryError what="work orders" error={workOrdersErrorDetail} onRetry={() => void refetchWorkOrders()} />
            ) : workOrdersLoading ? (
              <p className="text-sm text-muted-foreground">Loading linked work orders…</p>
            ) : !workOrders?.length ? (
              <p className="text-sm text-muted-foreground">No work orders are linked to this item. Failed inspections will create one automatically.</p>
            ) : (
              <div className="space-y-2">
                {workOrders.map((order) => (
                  <Link key={order.id} href={`/app/maintenance/${order.id}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/40">
                    <div><p className="text-sm font-semibold text-primary">{order.work_order_number}</p><p className="line-clamp-1 text-xs text-muted-foreground">{order.problem_description}</p></div>
                    <Badge variant="outline">{humanize(order.status)}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <MaintenanceQrCode path={`/app/maintenance/scan/asset/${item.qr_token}`} fileName={`maintenance-${item.label.replace(/\s+/g, "-").toLowerCase()}`} label={item.label} />
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> Inspection History</CardTitle>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : eventsError ? (
            <QueryError what="inspection history" error={eventsErrorDetail} onRetry={() => void refetchEvents()} />
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
                      {e.evacuation_time_exceeded && <p className="text-xs text-destructive font-semibold">Evacuation time exceeded the {e.evacuation_limit_seconds}-second standard. This finding remains part of this drill's record.</p>}
                      {e.alarm_sounded != null && <p className="text-xs">Alarm sounded: {e.alarm_sounded ? "Yes" : "No"}{e.blocked_exit_route ? ` · Simulated blocked route: ${e.blocked_exit_route}` : ""}</p>}
                      {e.evacuation_exception && <p className="text-xs">Participation exception: {e.evacuation_exception}</p>}
                      {e.fire_safety_expert_name && <p className="text-xs">Expert: {e.fire_safety_expert_name} · {e.fire_safety_expert_qualification}</p>}
                      {e.submitted_to_agency_at && <p className="text-xs">Submitted to local emergency management: {e.submitted_to_agency_at}</p>}
                      {e.notes && <p className="text-xs text-muted-foreground">Evidence: {e.notes}</p>}
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

      <Dialog open={showEventForm} onOpenChange={(o) => { if (!o) { setShowEventForm(false); resetEventForm(); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Log Inspection</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            {INSPECTION_RULES[item.item_type] && <p className="col-span-full text-sm text-muted-foreground">{INSPECTION_RULES[item.item_type].guidance}</p>}
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-date`} className="text-[13px]">Date *</Label>
              <Input id={`${__fieldIds}-date`} type="date" value={performedDate} onChange={(e) => setPerformedDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-performed-by`} className="text-[13px]">Performed By *</Label>
              <Input id={`${__fieldIds}-performed-by`}
                value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} placeholder="Staff name or vendor"
                className={cn("h-9", showValidation && errorFieldClass(fieldErrors.performedBy))}
              />
              {showValidation && <FieldError message={fieldErrors.performedBy} />}
            </div>
            <div className="col-span-full space-y-1.5">
              <Label htmlFor={`${__fieldIds}-result`} className="text-[13px]">Result *</Label>
              <Select value={result} onValueChange={(v) => setResult(v as typeof result)}>
                <SelectTrigger id={`${__fieldIds}-result`} className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["pass", "fail", "deficiency_noted"].map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {result !== "pass" && (
              <div className="col-span-full space-y-1.5">
                <Label htmlFor={`${__fieldIds}-deficiency-notes`} className="text-[13px]">Deficiency Notes</Label>
                <Textarea id={`${__fieldIds}-deficiency-notes`} value={deficiencyNotes} onChange={(e) => setDeficiencyNotes(e.target.value)} placeholder="What was found" />
              </div>
            )}
            {finding && <p className="col-span-full text-sm text-destructive">{finding} This record will be saved with a deficiency.</p>}
            {needsExpert && <>
              <div><Label htmlFor={`${__fieldIds}-expert-name`}>Fire safety expert *</Label><Input id={`${__fieldIds}-expert-name`} value={expertName} onChange={(e) => setExpertName(e.target.value)} /></div>
              <div><Label htmlFor={`${__fieldIds}-expert-qualification`}>Expert qualification *</Label><Input id={`${__fieldIds}-expert-qualification`} value={expertQualification} onChange={(e) => setExpertQualification(e.target.value)} />{showValidation && <FieldError message={fieldErrors.expert} />}</div>
            </>}
            {isPlanReview && <div className="col-span-full"><Label htmlFor={`${__fieldIds}-submitted-date`}>Submitted to local emergency management agency *</Label><Input id={`${__fieldIds}-submitted-date`} type="date" value={submittedDate} onChange={(e) => setSubmittedDate(e.target.value)} />{showValidation && <FieldError message={fieldErrors.submission} />}</div>}
            {!isFireDrill && <div className="col-span-full"><Label htmlFor={`${__fieldIds}-evidence-notes`}>Evidence / document reference {needsEvidence ? "*" : ""}</Label><Textarea id={`${__fieldIds}-evidence-notes`} value={evidenceNotes} onChange={(e) => setEvidenceNotes(e.target.value)} placeholder="Record the findings, relevant dates, document location and actions taken." />{showValidation && <FieldError message={fieldErrors.evidence} />}</div>}

            {isFireDrill && (
              <>
                <div className="col-span-2 pt-2 border-t">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">DHS Fire Drill Record Fields</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-time`} className="text-[13px]">Time</Label>
                  <Input id={`${__fieldIds}-time`}
                    type="time" value={drillTime} onChange={(e) => setDrillTime(e.target.value)}
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.drillTime))}
                  />
                  {showValidation && <FieldError message={fieldErrors.drillTime} />}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-shift`} className="text-[13px]">Shift</Label>
                  <Select value={shift} onValueChange={(v) => setShift(v as typeof shift)}>
                    <SelectTrigger id={`${__fieldIds}-shift`} className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SHIFT_OPTIONS.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-evacuation-duration-min`} className="text-[13px]">Evacuation Duration (min)</Label>
                  {result !== "pass" && <p className="text-xs text-muted-foreground">If evacuation was stopped, record any measured elapsed time and explain the incomplete drill in Problems Encountered.</p>}
                  <Input id={`${__fieldIds}-evacuation-duration-min`}
                    type="number" min={0} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)}
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.evacuationDuration))}
                  />
                  {showValidation && <FieldError message={fieldErrors.evacuationDuration} />}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-duration-sec`} className="text-[13px]">Duration (sec)</Label>
                  <Input id={`${__fieldIds}-duration-sec`}
                    type="number" min={0} max={59} value={durationSeconds} onChange={(e) => setDurationSeconds(e.target.value)}
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.evacuationDuration))}
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-exit-route-used`} className="text-[13px]">Exit Route Used</Label>
                  <Input id={`${__fieldIds}-exit-route-used`}
                    value={exitRouteUsed} onChange={(e) => setExitRouteUsed(e.target.value)} placeholder="e.g. East stairwell to rear parking lot"
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.exitRouteUsed))}
                  />
                  {showValidation && <FieldError message={fieldErrors.exitRouteUsed} />}
                </div>
                <div className="col-span-full"><Label htmlFor={`${__fieldIds}-blocked-route`}>Route blocked by the simulated fire</Label><Input id={`${__fieldIds}-blocked-route`} value={blockedRoute} onChange={(e) => setBlockedRoute(e.target.value)} placeholder="List the blocked route; exit routes above should list every route actually used." /></div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-residents-present`} className="text-[13px]">Residents Present</Label>
                  <Input id={`${__fieldIds}-residents-present`}
                    type="number" min={0} value={residentsPresent} onChange={(e) => setResidentsPresent(e.target.value)}
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.residentsPresent))}
                  />
                  {showValidation && <FieldError message={fieldErrors.residentsPresent} />}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-residents-evacuated`} className="text-[13px]">Residents Evacuated</Label>
                  <Input id={`${__fieldIds}-residents-evacuated`}
                    type="number" min={0} value={residentsEvacuated} onChange={(e) => setResidentsEvacuated(e.target.value)}
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.residentsEvacuated))}
                  />
                  {showValidation && <FieldError message={fieldErrors.residentsEvacuated} />}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-staff-participating`} className="text-[13px]">Staff Participating</Label>
                  <Input id={`${__fieldIds}-staff-participating`}
                    type="number" min={0} value={staffParticipating} onChange={(e) => setStaffParticipating(e.target.value)}
                    className={cn("h-9", showValidation && errorFieldClass(fieldErrors.staffParticipating))}
                  />
                  {showValidation && <FieldError message={fieldErrors.staffParticipating} />}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-alarm-detector-operative`} className="text-[13px]">Alarm/Detector Operative</Label>
                  <Select value={alarmOperative} onValueChange={setAlarmOperative}>
                    <SelectTrigger id={`${__fieldIds}-alarm-detector-operative`} className="h-9"><SelectValue placeholder="Select observed result" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label htmlFor={`${__fieldIds}-alarm-sounded`}>Alarm / detector set off *</Label><Select value={alarmSounded} onValueChange={setAlarmSounded}><SelectTrigger id={`${__fieldIds}-alarm-sounded`}><SelectValue placeholder="Select observed result" /></SelectTrigger><SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent></Select>{showValidation && <FieldError message={fieldErrors.alarm} />}</div>
                <fieldset className="col-span-full space-y-2"><legend className="text-sm font-medium">Detector / alarm tested during this drill</legend>
                  <p className="text-xs text-muted-foreground">Select the one device whose activation and operation are recorded above. Log additional devices separately on their inspection pages so each keeps its own result. An unsuccessful evacuation still preserves this device's test.</p>
                  {equipmentError && <p className="text-xs text-destructive">Equipment could not be loaded. Save the drill and record the equipment test separately.</p>}
                  <Label htmlFor={`${__fieldIds}-tested-alarm`}>Device to record</Label>
                  <Select value={testedAlarmIds[0] ?? "none"} onValueChange={(value) => setTestedAlarmIds(value === "none" ? [] : [value])}>
                    <SelectTrigger id={`${__fieldIds}-tested-alarm`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">No device test to record</SelectItem>{alarmItems.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.label}</SelectItem>)}</SelectContent>
                  </Select>
                </fieldset>
                <div className="col-span-full"><Label htmlFor={`${__fieldIds}-evacuation-exception`}>Reason any resident did not evacuate</Label><Textarea id={`${__fieldIds}-evacuation-exception`} value={evacuationException} onChange={(e) => setEvacuationException(e.target.value)} placeholder="Record corrective action; identify any documented hospice exception permitted by §2800.29. A refusal alone is not an exception." /></div>
                <div className="col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox" id="sleeping-hours" checked={isSleepingHoursDrill}
                    onChange={(e) => setIsSleepingHoursDrill(e.target.checked)} className="h-4 w-4"
                  />
                  <Label htmlFor="sleeping-hours" className="text-[13px] cursor-pointer">
                    Sleeping-hours drill ({item.sleeping_hours_start.slice(0, 5)}–{item.sleeping_hours_end.slice(0, 5)}; every 6 months)
                  </Label>
                  {showValidation && <FieldError message={fieldErrors.sleeping} />}
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-problems-encountered`} className="text-[13px]">Problems Encountered</Label>
                  <Textarea id={`${__fieldIds}-problems-encountered`}
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
            <Button variant="outline" onClick={() => { setShowEventForm(false); resetEventForm(); }}>Cancel</Button>
            <Button onClick={handleLogEvent} disabled={creatingEvent} className="shadow-sm">
              {creatingEvent ? "Saving..." : "Log Inspection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
