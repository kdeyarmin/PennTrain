import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, CalendarClock, CheckCircle2, History, Loader2,
  Pause, Play, Plus, RefreshCw, Send, ShieldCheck, TrendingDown, TrendingUp,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import {
  REPORT_KINDS, type ReportDeliveryMethod, type ReportFrequency,
  type ScheduledReportInput, type ScheduledReportKind,
  usePublishReportSnapshot, useRetryReportDelivery, useRetryScheduledReportRun,
  useRunScheduledReportNow, useSaveScheduledReport, useScheduledReportRuns,
  useScheduledReports, useSetScheduledReportEnabled,
} from "@/hooks/useScheduledReports";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { toLocalIsoDate } from "@/lib/dateUtils";

const today = () => toLocalIsoDate();
const defaultForm = (): ScheduledReportInput => ({
  name: "", reportKind: "employee_expirations", facilityId: undefined,
  frequency: "weekly", timeZone: "America/New_York", dateRangeMode: "rolling",
  lookbackDays: 30, deliveryMethods: ["in_app"], recipientProfileIds: [],
  retentionDays: 2555, enabled: true, publishToEvidenceRoom: false,
});
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The operation could not be completed.";
const displayDateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "—";
const asNumber = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0);

export default function ScheduledReports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = user?.role === "org_admin" || user?.role === "facility_manager";
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ScheduledReportInput>(defaultForm);
  const { data: schedules = [], isLoading: loadingSchedules, error: schedulesError } = useScheduledReports();
  const { data: runs = [], isLoading: loadingRuns, error: runsError } = useScheduledReportRuns();
  const { data: facilities = [] } = useListFacilities();
  const { data: profiles = [] } = useListProfiles({ organizationId: user?.organizationId ?? undefined });
  const save = useSaveScheduledReport();
  const toggle = useSetScheduledReportEnabled();
  const runNow = useRunScheduledReportNow();
  const retryRun = useRetryScheduledReportRun();
  const retryDelivery = useRetryReportDelivery();
  const publish = usePublishReportSnapshot();
  const recipients = useMemo(() => profiles.filter((p) => p.is_active && ["org_admin", "facility_manager", "auditor"].includes(p.role)), [profiles]);

  const mutate = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); toast({ title: success }); }
    catch (error) { toast({ title: "Unable to complete action", description: errorMessage(error), variant: "destructive" }); }
  };
  const updateDelivery = (method: ReportDeliveryMethod, checked: boolean) => setForm((current) => ({
    ...current,
    deliveryMethods: checked
      ? Array.from(new Set([...current.deliveryMethods, method]))
      : current.deliveryMethods.filter((value) => value !== method),
    publishToEvidenceRoom: method === "evidence_room" ? checked : current.publishToEvidenceRoom,
  }));
  const updateRecipient = (id: string, checked: boolean) => setForm((current) => ({
    ...current,
    recipientProfileIds: checked
      ? Array.from(new Set([...current.recipientProfileIds, id]))
      : current.recipientProfileIds.filter((value) => value !== id),
  }));
  const handleSave = () => mutate(async () => {
    await save.mutateAsync(form);
    setShowForm(false);
    setForm(defaultForm());
  }, "Scheduled report saved");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Link href="/app/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Reports
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Scheduled historical reports</h1>
          <p className="max-w-3xl text-muted-foreground">
            Deliver immutable, reconciled snapshots on a recurring schedule and compare each result with the prior period.
          </p>
        </div>
        {canManage && <Button onClick={() => setShowForm(true)}><Plus className="mr-2 h-4 w-4" />New schedule</Button>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>Active schedules</CardDescription><CardTitle className="text-3xl">{schedules.filter((s) => s.enabled).length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Reconciled snapshots</CardDescription><CardTitle className="text-3xl">{runs.filter((r) => r.snapshot?.reconciliation_status === "reconciled").length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Delivery failures</CardDescription><CardTitle className="text-3xl">{runs.flatMap((r) => r.deliveries).filter((d) => d.status === "failed" || d.provider_delivery?.final_outcome === "failed").length}</CardTitle></CardHeader></Card>
      </div>

      {(schedulesError || runsError) && <Alert variant="destructive"><AlertDescription>{errorMessage(schedulesError ?? runsError)}</AlertDescription></Alert>}

      <Tabs defaultValue="schedules">
        <TabsList><TabsTrigger value="schedules"><CalendarClock className="mr-2 h-4 w-4" />Schedules</TabsTrigger><TabsTrigger value="history"><History className="mr-2 h-4 w-4" />History & trends</TabsTrigger></TabsList>
        <TabsContent value="schedules" className="mt-4 space-y-3">
          {loadingSchedules && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>}
          {!loadingSchedules && schedules.length === 0 && <Card><CardContent className="py-12 text-center text-muted-foreground">No historical report schedules yet.</CardContent></Card>}
          {schedules.map((schedule) => (
            <Card key={schedule.id}>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><CardTitle className="text-lg">{schedule.report_definition?.name ?? "Scheduled report"}</CardTitle><CardDescription>{REPORT_KINDS.find(([id]) => id === schedule.report_kind)?.[1]} · {schedule.facility_id ? facilities.find((f) => f.id === schedule.facility_id)?.name ?? "Facility" : "Entire organization"}</CardDescription></div>
                <div className="flex flex-wrap gap-2"><StatusBadge status={schedule.enabled ? "active" : "paused"} /><Badge variant="outline">{schedule.frequency}</Badge></div>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><span className="block text-xs text-muted-foreground">Next run</span>{displayDateTime(schedule.next_run_at)}</div>
                  <div><span className="block text-xs text-muted-foreground">Date range</span>{schedule.date_range_mode === "rolling" ? `Rolling ${schedule.lookback_days} days` : `${schedule.fixed_date_from} – ${schedule.fixed_date_to}`}</div>
                  <div><span className="block text-xs text-muted-foreground">Retention</span>{schedule.retention_days} days</div>
                  <div><span className="block text-xs text-muted-foreground">Delivery</span>{schedule.delivery_methods.join(", ").replaceAll("_", " ")}</div>
                </div>
                {canManage && <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={runNow.isPending} onClick={() => mutate(() => runNow.mutateAsync({ scheduleId: schedule.id, asOfDate: today() }), "Report generated")}><Play className="mr-1.5 h-3.5 w-3.5" />Run now</Button>
                  <Button variant="outline" size="sm" disabled={toggle.isPending} onClick={() => mutate(() => toggle.mutateAsync({ scheduleId: schedule.id, enabled: !schedule.enabled }), schedule.enabled ? "Schedule paused" : "Schedule resumed")}>{schedule.enabled ? <Pause className="mr-1.5 h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}{schedule.enabled ? "Pause" : "Resume"}</Button>
                </div>}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Generation and delivery history</CardTitle><CardDescription>Every run, reconciliation result, delivery attempt, retry, and evidence-room publication.</CardDescription></CardHeader>
            <CardContent className="p-0">
              {loadingRuns ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
                <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>As of</TableHead><TableHead>Status</TableHead><TableHead>Reconciliation</TableHead><TableHead>Trend</TableHead><TableHead>Delivery</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>{runs.map((run) => {
                    const rawChange = run.snapshot?.trend_comparison
                      ? (run.snapshot.trend_comparison as Record<string, unknown>).absoluteChange
                      : null;
                    const change = rawChange === null || rawChange === undefined ? null : asNumber(rawChange);
                    const failed = run.deliveries.filter((d) => d.status === "failed" || d.provider_delivery?.final_outcome === "failed");
                    const published = run.deliveries.some((d) => d.delivery_method === "evidence_room" && d.status === "published");
                    return <TableRow key={run.id}>
                      <TableCell className="font-medium">{run.schedule?.report_definition?.name ?? "Scheduled report"}<span className="block text-xs font-normal text-muted-foreground">{run.trigger_type} · attempt {run.attempt_number}</span></TableCell>
                      <TableCell>{run.as_of_date}<span className="block text-xs text-muted-foreground">{run.period_start} – {run.period_end}</span></TableCell>
                      <TableCell><StatusBadge status={run.status} /></TableCell>
                      <TableCell>{run.snapshot ? <StatusBadge status={run.snapshot.reconciliation_status} /> : "—"}</TableCell>
                      <TableCell>{run.snapshot && change !== null ? <span className={`inline-flex items-center gap-1 ${change > 0 ? "text-amber-700" : change < 0 ? "text-emerald-700" : "text-muted-foreground"}`}>{change > 0 ? <TrendingUp className="h-4 w-4" /> : change < 0 ? <TrendingDown className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{change > 0 ? "+" : ""}{change}</span> : "—"}</TableCell>
                      <TableCell><div className="flex flex-wrap gap-1">{run.deliveries.map((delivery) => <Badge key={delivery.id} variant={delivery.status === "failed" || delivery.provider_delivery?.final_outcome === "failed" ? "destructive" : "outline"}>{delivery.delivery_method.replace("_", " ")}: {delivery.provider_delivery?.final_outcome ?? delivery.status}</Badge>)}</div></TableCell>
                      <TableCell><div className="flex justify-end gap-1">{canManage && run.status === "failed" && <Button variant="ghost" size="sm" onClick={() => mutate(() => retryRun.mutateAsync(run.id), "Report retry queued")}><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry run</Button>}{canManage && failed.map((delivery) => <Button key={delivery.id} variant="ghost" size="sm" onClick={() => mutate(() => retryDelivery.mutateAsync(delivery.id), "Delivery retry queued")}><Send className="mr-1 h-3.5 w-3.5" />Retry</Button>)}{canManage && run.snapshot?.facility_id && !published && <Button variant="ghost" size="sm" onClick={() => mutate(() => publish.mutateAsync(run.snapshot!.id), "Published to evidence room")}><ShieldCheck className="mr-1 h-3.5 w-3.5" />Publish</Button>}</div></TableCell>
                    </TableRow>;
                  })}{runs.length === 0 && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No report runs yet.</TableCell></TableRow>}</TableBody>
                </Table></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Create scheduled report</DialogTitle></DialogHeader>
          <div className="grid gap-5 py-2 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label>Report name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Weekly open incidents" /></div>
            <div className="space-y-1.5"><Label>Report</Label><Select value={form.reportKind} onValueChange={(value) => setForm({ ...form, reportKind: value as ScheduledReportKind })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{REPORT_KINDS.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Scope</Label><Select value={form.facilityId ?? "organization"} onValueChange={(value) => setForm({ ...form, facilityId: value === "organization" ? undefined : value, deliveryMethods: value === "organization" ? form.deliveryMethods.filter((m) => m !== "evidence_room") : form.deliveryMethods, publishToEvidenceRoom: value === "organization" ? false : form.publishToEvidenceRoom })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{user?.role === "org_admin" && <SelectItem value="organization">Entire organization</SelectItem>}{facilities.map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Frequency</Label><Select value={form.frequency} onValueChange={(value) => setForm({ ...form, frequency: value as ReportFrequency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["daily","weekly","monthly","quarterly","annual"].map((value) => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Time zone</Label><Input value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Date range</Label><Select value={form.dateRangeMode} onValueChange={(value) => setForm({ ...form, dateRangeMode: value as "rolling" | "fixed" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="rolling">Rolling lookback</SelectItem><SelectItem value="fixed">Fixed dates</SelectItem></SelectContent></Select></div>
            {form.dateRangeMode === "rolling" ? <div className="space-y-1.5"><Label>Lookback days</Label><Input type="number" min={1} max={3660} value={form.lookbackDays} onChange={(e) => setForm({ ...form, lookbackDays: Number(e.target.value) })} /></div> : <><div className="space-y-1.5"><Label>From</Label><Input type="date" value={form.fixedDateFrom ?? ""} onChange={(e) => setForm({ ...form, fixedDateFrom: e.target.value })} /></div><div className="space-y-1.5"><Label>To</Label><Input type="date" value={form.fixedDateTo ?? ""} onChange={(e) => setForm({ ...form, fixedDateTo: e.target.value })} /></div></>}
            <div className="space-y-1.5"><Label>As-of date (optional)</Label><Input type="date" value={form.fixedAsOfDate ?? ""} onChange={(e) => setForm({ ...form, fixedAsOfDate: e.target.value })} /><p className="text-xs text-muted-foreground">Leave blank to use each scheduled run date.</p></div>
            <div className="space-y-1.5"><Label>Retention days</Label><Input type="number" min={1} max={36500} value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Delivery methods</Label><div className="flex flex-wrap gap-4">{(["in_app","email_link","evidence_room"] as ReportDeliveryMethod[]).map((method) => <label key={method} className="flex items-center gap-2 text-sm"><Checkbox checked={form.deliveryMethods.includes(method)} disabled={method === "evidence_room" && !form.facilityId} onCheckedChange={(checked) => updateDelivery(method, checked === true)} />{method.replaceAll("_", " ")}</label>)}</div></div>
            <div className="space-y-2 sm:col-span-2"><Label>Authorized recipients</Label><div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">{recipients.map((profile) => <label key={profile.id} className="flex items-start gap-2 text-sm"><Checkbox checked={form.recipientProfileIds.includes(profile.id)} onCheckedChange={(checked) => updateRecipient(profile.id, checked === true)} /><span>{profile.first_name} {profile.last_name}<span className="block text-xs text-muted-foreground">{profile.email} · {profile.role.replace("_", " ")}</span></span></label>)}{recipients.length === 0 && <p className="text-sm text-muted-foreground">No authorized reporting users are available.</p>}</div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button><Button onClick={handleSave} disabled={save.isPending || form.name.trim().length < 3 || form.deliveryMethods.length === 0 || (form.deliveryMethods.some((m) => m !== "evidence_room") && form.recipientProfileIds.length === 0)}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save schedule</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
