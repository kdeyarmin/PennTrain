import { useState } from "react";
import { CalendarClock, Loader2, Mail, Pencil, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import {
  useReportScheduleOperations,
  useReportSchedulePreview,
  useSaveReportSchedule,
  useSetReportScheduleEnabled,
} from "@/hooks/useProductValueOperatingSystem";
import { useListSavedReportViews } from "@/hooks/useSavedReports";
import { useAuth } from "@/lib/auth";
import {
  REPORT_SCHEDULE_ROLE_OPTIONS,
  REPORT_SCHEDULE_WEEKDAYS,
  changeReportScheduleFrequency,
  createDefaultReportScheduleForm,
  describeReportSchedule,
  formatReportScheduleRunAt,
  isReportScheduleFormValid,
  reportScheduleToForm,
  type ReportSchedule,
  type ReportScheduleAudienceRole,
  type ReportScheduleDeliveryMode,
  type ReportScheduleForm,
  type ReportScheduleFrequency,
  type ReportScheduleRun,
} from "@/lib/reportSchedule";

function human(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function ScheduleRun({ run, timeZone }: { run: ReportScheduleRun; timeZone: string }) {
  return <div className="rounded-md border bg-muted/20 p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-medium">{formatReportScheduleRunAt(run.scheduledFor, timeZone)}</span>
      <Badge variant={run.status === "failed" ? "destructive" : run.status === "partial" ? "secondary" : "outline"}>
        {human(run.status)}
      </Badge>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">
      {run.inAppCount} in-app · {run.emailQueuedCount} email queued
      {run.emailSkippedCount > 0 ? ` · ${run.emailSkippedCount} email skipped` : ""}
    </p>
    {run.errorMessage && <p className="mt-1 text-xs text-destructive">{run.errorMessage}</p>}
  </div>;
}

function ScheduleCard({
  schedule,
  canManage,
  onEdit,
}: {
  schedule: ReportSchedule;
  canManage: boolean;
  onEdit: (schedule: ReportSchedule) => void;
}) {
  const { toast } = useToast();
  const setEnabled = useSetReportScheduleEnabled();
  const changeEnabled = async () => {
    try {
      await setEnabled.mutateAsync({ scheduleId: schedule.id, enabled: !schedule.enabled });
      toast({ title: schedule.enabled ? "Report subscription paused" : "Report subscription enabled" });
    } catch (error) {
      toast({
        title: "Report subscription could not be changed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return <Card>
    <CardHeader className="pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{schedule.name}</CardTitle>
            <Badge variant={schedule.enabled ? "outline" : "secondary"}>{schedule.enabled ? "Active" : "Paused"}</Badge>
            <Badge variant="secondary">{schedule.deliveryMode === "email_link" ? "Email link + in-app" : schedule.deliveryMode === "evidence_room" ? "Legacy evidence room" : "In-app"}</Badge>
          </div>
          <CardDescription className="mt-1">
            {describeReportSchedule(schedule)} · {schedule.timeZone}
          </CardDescription>
        </div>
        {canManage && <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onEdit(schedule)}>
            <Pencil className="mr-2 h-4 w-4" />Edit
          </Button>
          <Button size="sm" variant="outline" disabled={setEnabled.isPending} onClick={() => void changeEnabled()}>
            {schedule.enabled ? "Pause" : "Enable"}
          </Button>
        </div>}
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div><span className="text-muted-foreground">Audience:</span> {(schedule.audience.roles ?? []).map(human).join(", ") || "Not set"}</div>
        <div><span className="text-muted-foreground">Next run:</span> {schedule.nextRunAt ? formatReportScheduleRunAt(schedule.nextRunAt, schedule.timeZone) : "Pending"}</div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent delivery history</p>
        {schedule.runs.length
          ? <div className="grid gap-2 lg:grid-cols-2">{schedule.runs.slice(0, 4).map((run) => <ScheduleRun key={run.id} run={run} timeZone={schedule.timeZone} />)}</div>
          : <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No delivery runs yet.</p>}
      </div>
    </CardContent>
  </Card>;
}

export function ReportScheduleManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = user?.role === "platform_admin" || user?.role === "org_admin" || user?.role === "facility_manager";
  const savedReports = useListSavedReportViews();
  const operations = useReportScheduleOperations();
  const saveSchedule = useSaveReportSchedule();
  const [form, setForm] = useState<ReportScheduleForm>(() => createDefaultReportScheduleForm());
  const formValid = isReportScheduleFormValid(form);
  const preview = useReportSchedulePreview(form, Boolean(canManage && formValid));

  const updateForm = <K extends keyof ReportScheduleForm>(field: K, value: ReportScheduleForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };
  const toggleRole = (role: ReportScheduleAudienceRole, checked: boolean) => {
    setForm((current) => ({
      ...current,
      roles: checked
        ? Array.from(new Set([...current.roles, role]))
        : current.roles.filter((item) => item !== role),
    }));
  };
  const resetForm = () => setForm(createDefaultReportScheduleForm(form.timeZone));
  const editSchedule = (schedule: ReportSchedule) => {
    setForm(reportScheduleToForm(schedule));
    document.getElementById("report-schedule-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const submit = async () => {
    const wasEditing = Boolean(form.scheduleId);
    try {
      await saveSchedule.mutateAsync(form);
      toast({ title: wasEditing ? "Report subscription updated" : "Report subscription scheduled" });
      resetForm();
    } catch (error) {
      toast({
        title: "Report subscription could not be saved",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return <div className="space-y-4">
    <div className="grid gap-5 xl:grid-cols-2">
      <Card id="report-schedule-editor">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>{form.scheduleId ? "Edit report subscription" : "Schedule a saved report"}</CardTitle>
              <CardDescription>Deliver a secure saved-report link to selected roles on a timezone-aware schedule.</CardDescription>
            </div>
            {form.scheduleId && <Button size="sm" variant="ghost" onClick={resetForm}>
              <RotateCcw className="mr-2 h-4 w-4" />Cancel edit
            </Button>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage ? <Alert>
            <CalendarClock className="h-4 w-4" />
            <AlertTitle>Read-only access</AlertTitle>
            <AlertDescription>Organization admins and facility managers can create or change report subscriptions.</AlertDescription>
          </Alert> : savedReports.isLoading ? <QueryLoading what="saved reports" /> : savedReports.isError ? <QueryError what="saved reports" error={savedReports.error} onRetry={() => savedReports.refetch()} /> : <>
            <div className="space-y-2">
              <Label>Saved report</Label>
              <Select value={form.reportDefinitionId} onValueChange={(value) => updateForm("reportDefinitionId", value)}>
                <SelectTrigger><SelectValue placeholder="Choose saved report" /></SelectTrigger>
                <SelectContent>{savedReports.data?.map((report) => <SelectItem key={report.id} value={report.id}>{report.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={(value) => setForm((current) => changeReportScheduleFrequency(current, value as ReportScheduleFrequency))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.frequency === "weekly" && <div className="space-y-2">
                <Label>Day of week</Label>
                <Select value={String(form.dayOfWeek ?? 1)} onValueChange={(value) => updateForm("dayOfWeek", Number(value))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REPORT_SCHEDULE_WEEKDAYS.map((day, index) => <SelectItem key={day} value={String(index + 1)}>{day}</SelectItem>)}</SelectContent>
                </Select>
              </div>}
              {form.frequency === "monthly" && <div className="space-y-2">
                <Label htmlFor="report-month-day">Day of month</Label>
                <Input id="report-month-day" type="number" min="1" max="28" value={form.dayOfMonth ?? 1} onChange={(event) => updateForm("dayOfMonth", Number(event.target.value))} />
              </div>}
              <div className="space-y-2">
                <Label htmlFor="report-hour">Hour (0–23)</Label>
                <Input id="report-hour" type="number" min="0" max="23" value={form.deliveryHour} onChange={(event) => updateForm("deliveryHour", Number(event.target.value))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-minute">Minute (0–59)</Label>
                <Input id="report-minute" type="number" min="0" max="59" value={form.deliveryMinute} onChange={(event) => updateForm("deliveryMinute", Number(event.target.value))} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="report-time-zone">Time zone</Label>
                <Input id="report-time-zone" value={form.timeZone} onChange={(event) => updateForm("timeZone", event.target.value)} placeholder="America/New_York" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Delivery channel</Label>
                <Select value={form.deliveryMode} onValueChange={(value) => updateForm("deliveryMode", value as ReportScheduleDeliveryMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_app">In-app notification</SelectItem>
                    <SelectItem value="email_link">Email link + in-app notification</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Audience roles</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {REPORT_SCHEDULE_ROLE_OPTIONS.map((option) => <label key={option.value} className="flex items-center gap-2 rounded-md border p-3 text-sm">
                  <Checkbox checked={form.roles.includes(option.value)} onCheckedChange={(checked) => toggleRole(option.value, checked === true)} />
                  {option.label}
                </label>)}
              </div>
              {!form.roles.length && <p className="text-sm text-destructive">Select at least one audience role.</p>}
            </div>
            <Alert>
              {form.deliveryMode === "email_link" ? <Mail className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
              <AlertTitle>Next-run preview</AlertTitle>
              <AlertDescription>
                {!formValid ? "Complete the report, timing, timezone, and audience fields to preview the next run."
                  : preview.isLoading ? <span className="inline-flex items-center"><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Calculating with the configured timezone…</span>
                    : preview.isError ? `Preview unavailable: ${preview.error instanceof Error ? preview.error.message : String(preview.error)}`
                      : preview.data ? `${describeReportSchedule(form)}. Next run: ${formatReportScheduleRunAt(preview.data.nextRunAt, form.timeZone)} (${form.timeZone}).` : "Preview pending."}
              </AlertDescription>
            </Alert>
            <Button disabled={!formValid || preview.isLoading || preview.isError || !preview.data || saveSchedule.isPending} onClick={() => void submit()}>
              {saveSchedule.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
              {form.scheduleId ? "Save changes" : "Schedule report"}
            </Button>
          </>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>How delivery works</CardTitle>
          <CardDescription>Every run stays permission-checked and leaves an operational receipt.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Recipients are resolved from active profiles in the selected roles at run time.</p>
          <p>In-app notifications contain only a link. The report is opened with each recipient’s current permissions.</p>
          <p>Email links are queued only when organization email delivery is enabled and the recipient has not opted out. Skips appear in run history.</p>
          <p>Pausing preserves the configuration. Enabling recalculates the next run from the current time.</p>
        </CardContent>
      </Card>
    </div>

    {operations.isLoading ? <QueryLoading what="report subscriptions" />
      : operations.isError ? <QueryError what="report subscriptions" error={operations.error} onRetry={() => operations.refetch()} />
        : operations.data?.schedules.length
          ? <div className="space-y-3">{operations.data.schedules.map((schedule) => <ScheduleCard key={schedule.id} schedule={schedule} canManage={Boolean(canManage)} onEdit={editSchedule} />)}</div>
          : <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No report subscriptions have been configured.</div>}
  </div>;
}
