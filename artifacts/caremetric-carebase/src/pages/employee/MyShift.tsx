import { Link } from "wouter";
import { AlertTriangle, Bell, CalendarDays, CheckCircle2, ClipboardList, Clock, FileText, GraduationCap, MapPin, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueryError } from "@/components/QueryState";
import { useAcknowledgeShiftReportEntry, useCreateShiftReportEntry, useMyShiftWorkspace, useRecordShiftCallOff } from "@/hooks/useDailyOperations";
import { useToast } from "@/hooks/use-toast";
import { formatDateLabel, formatTimeLabel } from "@/lib/scheduleDates";

function CountBadge({ count }: { count: number }) {
  return <Badge variant={count ? "default" : "outline"}>{count}</Badge>;
}

export default function MyShift() {
  const { data, isLoading, isError, error, refetch, isFetching } = useMyShiftWorkspace();
  const acknowledge = useAcknowledgeShiftReportEntry();
  const callOff = useRecordShiftCallOff();
  const createHandoff = useCreateShiftReportEntry();
  const { toast } = useToast();
  const shift = data?.currentOrNextShift;

  const reportHandoff = (category: string, priority: string, title: string) => {
    if (!shift?.facility_id || !shift?.id) return;
    const narrative = window.prompt(`${title}: enter the details your manager needs to triage.`);
    if (!narrative?.trim()) return;
    createHandoff.mutate({
      facilityId: shift.facility_id,
      unitId: shift.unit_id,
      shiftAssignmentId: shift.id,
      category,
      priority,
      periodStart: new Date(`${shift.shift_date}T${shift.start_time}`).toISOString(),
      periodEnd: new Date(`${shift.shift_date}T${shift.end_time}`).toISOString(),
      narrative: narrative.trim(),
      requiresAcknowledgement: priority !== "low",
    }, {
      onSuccess: () => toast({ title: "Handoff recorded", description: "The item will carry forward until a manager resolves it or routes it into the full workflow." }),
      onError: (e: Error) => toast({ title: "Could not record handoff", description: e.message, variant: "destructive" }),
    });
  };

  const handleCallOff = () => {
    if (!shift?.id) return;
    if (!window.confirm("Report that you cannot work this shift? A manager will be alerted to fill coverage.")) return;
    callOff.mutate({ shiftAssignmentId: shift.id, category: "other", reason: "Employee reported call-off from My Shift" }, {
      onSuccess: () => toast({ title: "Call-off reported", description: "Coverage work was routed to the manager queue." }),
      onError: (e: Error) => toast({ title: "Could not report call-off", description: e.message, variant: "destructive" }),
    });
  };

  if (isError) return <QueryError what="your shift workspace" error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Shift</h1>
          <p className="text-sm text-muted-foreground">Today’s work, handoff items, and approved shortcuts.</p>
        </div>
        {isFetching && <Badge variant="outline">Refreshing…</Badge>}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>
      ) : !data?.employee ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No employee profile is linked to your account yet.</CardContent></Card>
      ) : (
        <>
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><CalendarDays className="h-5 w-5" />Current / next shift</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {shift ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xl font-semibold">{formatDateLabel(shift.shift_date, { weekday: "long", month: "short", day: "numeric" })}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" />{shift.shift_name ? `${shift.shift_name} · ` : ""}{formatTimeLabel(shift.start_time)}–{formatTimeLabel(shift.end_time)}</span>
                      <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{shift.facility_name}{shift.unit_name ? ` · ${shift.unit_name}` : ""}</span>
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button asChild className="min-h-11 justify-start"><Link href="/me/services"><CheckCircle2 className="mr-2 h-4 w-4" />Complete resident service</Link></Button>
                    <Button asChild variant="outline" className="min-h-11 justify-start"><Link href="/me/change-of-condition"><AlertTriangle className="mr-2 h-4 w-4" />Report condition change</Link></Button>
                    <Button variant="outline" className="min-h-11 justify-start" onClick={() => reportHandoff("fall_or_injury", "urgent", "Incident concern")} disabled={createHandoff.isPending}><FileText className="mr-2 h-4 w-4" />Incident concern</Button>
                    <Button variant="outline" className="min-h-11 justify-start" onClick={() => reportHandoff("maintenance", "high", "Maintenance concern")} disabled={createHandoff.isPending}><Wrench className="mr-2 h-4 w-4" />Maintenance concern</Button>
                  </div>
                  <Button variant="destructive" className="min-h-11 w-full sm:w-auto" onClick={handleCallOff} disabled={callOff.isPending}>Report call-off</Button>
                </div>
              ) : <p className="text-sm text-muted-foreground">No published shift is currently assigned. Check open offers and upcoming schedule below.</p>}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="flex items-center justify-between p-4"><span className="flex items-center gap-2 text-sm"><ClipboardList className="h-4 w-4" />Services</span><CountBadge count={data.residentServiceTasks.length} /></CardContent></Card>
            <Card><CardContent className="flex items-center justify-between p-4"><span className="flex items-center gap-2 text-sm"><Bell className="h-4 w-4" />Handoff</span><CountBadge count={data.handoffItems.length} /></CardContent></Card>
            <Card><CardContent className="flex items-center justify-between p-4"><span className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4" />Assigned work</span><CountBadge count={data.workItems.length} /></CardContent></Card>
            <Card><CardContent className="flex items-center justify-between p-4"><span className="flex items-center gap-2 text-sm"><GraduationCap className="h-4 w-4" />Unread notices</span><CountBadge count={data.notifications.length} /></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Handoff requiring attention</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.handoffItems.length === 0 ? <p className="text-sm text-muted-foreground">No unresolved handoff items for your facility.</p> : data.handoffItems.map((item) => (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2"><Badge>{String(item.priority).replace(/_/g, " ")}</Badge><span className="text-xs text-muted-foreground">{String(item.category).replace(/_/g, " ")}</span></div>
                  <p className="mt-2 text-sm">{item.narrative}</p>
                  {item.requires_acknowledgement && <Button size="sm" variant="outline" className="mt-3 min-h-10" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(String(item.id))}>Acknowledge</Button>}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Assigned resident services</CardTitle></CardHeader><CardContent className="space-y-2">{data.residentServiceTasks.length === 0 ? <p className="text-sm text-muted-foreground">No due service tasks in the current shift window.</p> : data.residentServiceTasks.map((task) => <Link key={task.id} href="/me/services" className="block rounded-lg border p-3 text-sm hover:bg-muted"><span className="font-medium">{task.service_name}</span><span className="block text-muted-foreground">{new Date(task.scheduled_start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {task.status}</span></Link>)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Upcoming shifts and offers</CardTitle></CardHeader><CardContent className="space-y-2">{data.upcomingShifts.slice(0, 4).map((s) => <Link key={s.id} href="/me/schedule" className="block rounded-lg border p-3 text-sm hover:bg-muted"><span className="font-medium">{formatDateLabel(s.shift_date, { month: "short", day: "numeric" })} · {formatTimeLabel(s.start_time)}–{formatTimeLabel(s.end_time)}</span><span className="block text-muted-foreground">{s.facility_name}{s.unit_name ? ` · ${s.unit_name}` : ""}</span></Link>)}{data.openShiftOffers.length > 0 && <p className="pt-2 text-sm text-muted-foreground">{data.openShiftOffers.length} open-shift offer(s) may be available after eligibility review.</p>}</CardContent></Card>
          </div>
        </>
      )}
    </div>
  );
}
