import { useMemo, useState } from "react";
import { CalendarDays, Clock, MapPin, RefreshCw, Repeat2, Umbrella } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListShiftAssignments } from "@/hooks/useShiftAssignments";
import {
  useClaimOpenShift,
  useMyShiftWorkspace,
  useRequestShiftSwap,
  useShiftSwapCandidates,
  useSubmitTimeOffRequest,
} from "@/hooks/useDailyOperations";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/QueryState";
import { formatDateLabel, formatTimeLabel, todayIso } from "@/lib/scheduleDates";
import { getTimeOffRequestWindowError, normalizeTimeOffRequestWindow } from "@/lib/timeOffRequest";

interface TimeOffDraft {
  startsAt: string;
  endsAt: string;
  reason: string;
}

export default function MySchedule() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const workspace = useMyShiftWorkspace();
  const submitTimeOff = useSubmitTimeOffRequest();
  const claimShift = useClaimOpenShift();
  const requestSwap = useRequestShiftSwap();
  const [timeOffDraft, setTimeOffDraft] = useState<TimeOffDraft | null>(null);
  const [swapAssignmentId, setSwapAssignmentId] = useState<string | null>(null);
  const [swapTargetId, setSwapTargetId] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const candidates = useShiftSwapCandidates(swapAssignmentId);
  const {
    data: shifts,
    isLoading: shiftsLoading,
    isError: shiftsError,
    error: shiftsErrorDetail,
    refetch: refetchShifts,
  } = useListShiftAssignments(
    { employeeId: employee?.id, fromDate: todayIso() },
    { enabled: !!employee?.id },
  );

  const upcoming = shifts ?? [];
  const facilityId = workspace.data?.currentOrNextShift?.facility_id
    ?? (employee as { facility_id?: string | null } | undefined)?.facility_id
    ?? null;
  const openOffers = workspace.data?.openShiftOffers ?? [];
  const timeOffRequests = workspace.data?.timeOffRequests ?? [];
  const isLoading = employeeLoading || shiftsLoading || workspace.isLoading;
  const selectedShift = useMemo(() => upcoming.find((shift) => shift.id === swapAssignmentId), [upcoming, swapAssignmentId]);
  const timeOffWindowError = timeOffDraft
    ? getTimeOffRequestWindowError(timeOffDraft.startsAt, timeOffDraft.endsAt)
    : null;

  const submitTimeOffRequest = async () => {
    if (!employee?.id || !facilityId || !timeOffDraft) return;
    try {
      const requestWindow = normalizeTimeOffRequestWindow(timeOffDraft.startsAt, timeOffDraft.endsAt);
      await submitTimeOff.mutateAsync({
        employeeId: employee.id,
        facilityId,
        startsAt: requestWindow.startsAtIso,
        endsAt: requestWindow.endsAtIso,
        reason: timeOffDraft.reason.trim(),
      });
      setTimeOffDraft(null);
      toast({ title: "Time-off request submitted", description: "Your manager can now review it in the workforce queue." });
    } catch (error) {
      toast({ title: "Could not submit request", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const submitSwapRequest = async () => {
    if (!swapAssignmentId || !swapTargetId || swapReason.trim().length < 5) return;
    try {
      await requestSwap.mutateAsync({ requesterAssignmentId: swapAssignmentId, targetAssignmentId: swapTargetId, reason: swapReason.trim() });
      setSwapAssignmentId(null);
      setSwapTargetId("");
      setSwapReason("");
      toast({ title: "Shift-swap request submitted", description: "A manager will recheck both employees' eligibility before approval." });
    } catch (error) {
      toast({ title: "Could not request swap", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleClaim = async (opportunityId: string) => {
    try {
      const result = await claimShift.mutateAsync(opportunityId) as { claim_status?: string } | undefined;
      toast({ title: "Open-shift request recorded", description: result?.claim_status ? `Status: ${result.claim_status.replace(/_/g, " ")}.` : "Check your schedule for the result." });
    } catch (error) {
      toast({ title: "Open shift unavailable", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Schedule</h1>
          <p className="text-muted-foreground">View shifts, request time off, claim eligible openings, and propose governed swaps.</p>
        </div>
        <Button
          onClick={() => setTimeOffDraft({ startsAt: "", endsAt: "", reason: "" })}
          disabled={!employee?.id || !facilityId}
        >
          <Umbrella className="mr-2 h-4 w-4" />Request time off
        </Button>
      </div>

      {shiftsError ? <QueryError what="your shifts" error={shiftsErrorDetail} onRetry={() => refetchShifts()} /> : null}
      {workspace.isError ? <QueryError what="schedule self-service" error={workspace.error} onRetry={() => workspace.refetch()} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />Upcoming shifts ({upcoming.length})</CardTitle>
          <CardDescription>Only published shifts are shown. Swap candidates are limited to your facility and remain subject to manager approval.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, index) => <div key={index} className="h-20 animate-pulse rounded bg-muted" />)}</div>
          ) : upcoming.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No upcoming shifts published yet.</p>
          ) : (
            <div className="space-y-2">
              {upcoming.map((shift) => (
                <div key={shift.id} className="flex flex-col justify-between gap-3 rounded-md border px-4 py-3 sm:flex-row sm:items-center">
                  <div>
                    <div className="font-medium">{formatDateLabel(shift.shift_date, { weekday: "long", month: "short", day: "numeric" })}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{shift.shift_definitions?.name ? `${shift.shift_definitions.name} · ` : ""}{formatTimeLabel(shift.start_time)}–{formatTimeLabel(shift.end_time)}</span>
                      {shift.facility_units?.name ? <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{shift.facility_units.name}</span> : null}
                    </div>
                    {shift.notes ? <p className="mt-1 text-sm text-muted-foreground">{shift.notes}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={shift.status} />
                    {(["scheduled", "confirmed"] as string[]).includes(shift.status) ? (
                      <Button variant="outline" size="sm" onClick={() => { setSwapAssignmentId(shift.id); setSwapTargetId(""); setSwapReason(""); }}>
                        <Repeat2 className="mr-2 h-4 w-4" />Request swap
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Open shifts</CardTitle><CardDescription>Claims run through qualification, credential, training, conflict, and policy checks.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {workspace.isLoading ? <RefreshCw className="h-5 w-5 animate-spin" /> : openOffers.length === 0 ? <p className="text-sm text-muted-foreground">No open shifts are available.</p> : openOffers.map((offer) => (
              <div key={String(offer.id)} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="text-sm"><p className="font-medium">{formatDateLabel(String(offer.shift_date), { month: "short", day: "numeric" })}</p><p className="text-muted-foreground">{formatTimeLabel(String(offer.start_time))}–{formatTimeLabel(String(offer.end_time))}</p></div>
                <Button size="sm" onClick={() => void handleClaim(String(offer.id))} disabled={claimShift.isPending}>Claim</Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent time-off requests</CardTitle><CardDescription>Status is updated after a manager decision.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {timeOffRequests.length === 0 ? <p className="text-sm text-muted-foreground">No recent requests.</p> : timeOffRequests.map((request) => (
              <div key={String(request.id)} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div><p className="font-medium">{new Date(String(request.starts_at)).toLocaleString()} – {new Date(String(request.ends_at)).toLocaleString()}</p><p className="text-muted-foreground">{String(request.request_type).replace(/_/g, " ")}</p></div>
                <Badge variant={request.status === "approved" ? "default" : "outline"}>{String(request.status)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(timeOffDraft)} onOpenChange={(open) => !open && setTimeOffDraft(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request time off</DialogTitle><DialogDescription>Enter the full unavailable period. Submitting does not approve the request or remove a published assignment.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2"><Label htmlFor="time-off-start">Starts</Label><Input id="time-off-start" type="datetime-local" value={timeOffDraft?.startsAt ?? ""} onChange={(event) => setTimeOffDraft((draft) => draft ? { ...draft, startsAt: event.target.value } : draft)} /></div>
            <div className="space-y-2"><Label htmlFor="time-off-end">Ends</Label><Input id="time-off-end" type="datetime-local" value={timeOffDraft?.endsAt ?? ""} onChange={(event) => setTimeOffDraft((draft) => draft ? { ...draft, endsAt: event.target.value } : draft)} /></div>
            {timeOffWindowError ? <p className="text-sm text-destructive">{timeOffWindowError}</p> : null}
            <div className="space-y-2"><Label htmlFor="time-off-reason">Reason</Label><Textarea id="time-off-reason" value={timeOffDraft?.reason ?? ""} onChange={(event) => setTimeOffDraft((draft) => draft ? { ...draft, reason: event.target.value } : draft)} maxLength={1000} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTimeOffDraft(null)}>Cancel</Button><Button onClick={() => void submitTimeOffRequest()} disabled={!timeOffDraft?.startsAt || !timeOffDraft.endsAt || Boolean(timeOffWindowError) || timeOffDraft.reason.trim().length < 5 || submitTimeOff.isPending}>Submit request</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(swapAssignmentId)} onOpenChange={(open) => !open && setSwapAssignmentId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request a shift swap</DialogTitle><DialogDescription>Your shift {selectedShift ? `on ${formatDateLabel(selectedShift.shift_date, { month: "short", day: "numeric" })}` : ""} will remain assigned until a manager approves the swap after rechecking both employees.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>Swap with</Label><Select value={swapTargetId} onValueChange={setSwapTargetId}><SelectTrigger><SelectValue placeholder={candidates.isLoading ? "Loading eligible options..." : "Select a coworker's shift"} /></SelectTrigger><SelectContent>{(candidates.data ?? []).map((candidate) => <SelectItem key={candidate.assignment_id} value={candidate.assignment_id}>{candidate.employee_name} · {formatDateLabel(candidate.shift_date, { month: "short", day: "numeric" })} · {formatTimeLabel(candidate.start_time)}–{formatTimeLabel(candidate.end_time)}</SelectItem>)}</SelectContent></Select>{candidates.isError ? <p className="text-sm text-destructive">{candidates.error instanceof Error ? candidates.error.message : "Could not load candidates."}</p> : null}{!candidates.isLoading && (candidates.data?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No candidate shifts are currently available at this facility.</p> : null}</div>
            <div className="space-y-2"><Label htmlFor="swap-reason">Reason</Label><Textarea id="swap-reason" value={swapReason} onChange={(event) => setSwapReason(event.target.value)} maxLength={1000} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setSwapAssignmentId(null)}>Cancel</Button><Button onClick={() => void submitSwapRequest()} disabled={!swapTargetId || swapReason.trim().length < 5 || requestSwap.isPending}>Submit swap</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
