import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/QueryState";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useSaveTrainingReminderPolicy, useSaveTrainingReportSchedule, useTrainingAutomation, type TrainingAutomation, type TrainingReminderPolicy, type TrainingReportSchedule } from "@/hooks/useTrainingAutomation";
import { saveableTrainingFilters, TRAINING_WEEKDAYS, trainingScheduleDayIsValid, type SavedTrainingFilters } from "@/lib/trainingAutomation";
import type { TrainingEnrollmentFilters } from "@/lib/trainingEnrollmentReport";
import { formatDateForDisplay } from "@/lib/dateUtils";

const selectClass = "h-10 rounded-md border bg-background px-3 text-sm";
function Recipients({ recipients, selected, onChange }: { recipients: TrainingAutomation["recipients"]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <div className="space-y-2">{recipients.map(person => <label className="flex gap-2 items-center text-sm" key={person.id}><input type="checkbox" checked={selected.includes(person.id)} onChange={e => onChange(e.target.checked ? [...selected, person.id] : selected.filter(id => id !== person.id))} />{person.name} ({person.role.replaceAll("_", " ")})</label>)}{selected.filter(id => !recipients.some(person => person.id === id)).map(id => <label className="flex gap-2 items-center text-sm" key={id}><input type="checkbox" checked onChange={() => onChange(selected.filter(value => value !== id))} />Previously selected administrator is no longer eligible. Uncheck to remove.</label>)}{!recipients.length && <p>No active facility administrators are available. Add an administrator before scheduling a report.</p>}</div>;
}
function ReminderForm({ facilityId, data }: { facilityId: string; data: TrainingAutomation }) {
  const [settings, setSettings] = useState<TrainingReminderPolicy>(() => ({ learner_enabled: data.settings.learner_enabled, lead_days: data.settings.lead_days, repeat_days: data.settings.repeat_days,
    digest_enabled: data.settings.digest_enabled, digest_weekday: data.settings.digest_weekday, escalation_days: data.settings.escalation_days, recipient_ids: data.settings.recipient_ids }));
  const save = useSaveTrainingReminderPolicy(facilityId);
  const { toast } = useToast();
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); save.mutate(settings, { onSuccess: () => toast({ title: "Training reminders updated" }) }); }}>
    <fieldset disabled={save.isPending} className="space-y-3">
      <label className="flex gap-2"><input type="checkbox" checked={settings.learner_enabled} onChange={e => setSettings(s => ({ ...s, learner_enabled: e.target.checked }))} />Remind learners about required courses</label>
      <div className="grid sm:grid-cols-2 gap-3"><label>Start reminders before the deadline (days)<Input type="number" required min={0} max={60} value={settings.lead_days} onChange={e => setSettings(s => ({ ...s, lead_days: Number(e.target.value) }))} /></label>
        <label>Repeat learner reminders every (days)<Input type="number" required min={1} max={30} value={settings.repeat_days} onChange={e => setSettings(s => ({ ...s, repeat_days: Number(e.target.value) }))} /></label></div>
      <label className="flex gap-2"><input type="checkbox" checked={settings.digest_enabled} onChange={e => setSettings(s => ({ ...s, digest_enabled: e.target.checked }))} />Send administrators overdue summaries and follow-up alerts</label>
      <div className="grid sm:grid-cols-2 gap-3"><label className="grid gap-1">Weekly summary day<select className={selectClass} value={settings.digest_weekday} onChange={e => setSettings(s => ({ ...s, digest_weekday: Number(e.target.value) }))}>{TRAINING_WEEKDAYS.map((day, i) => <option key={day} value={i + 1}>{day}</option>)}</select></label>
        <label>Flag for follow-up after overdue (days)<Input type="number" min={1} max={90} required value={settings.escalation_days} onChange={e => setSettings(s => ({ ...s, escalation_days: Number(e.target.value) }))} /></label></div>
      <div><p className="font-medium text-sm">Administrators receiving summaries and follow-up</p><p className="text-xs text-muted-foreground mb-2">Leave everyone unchecked to include all active administrators authorized for this facility. Access is checked again when messages are queued.</p><Recipients recipients={data.recipients} selected={settings.recipient_ids} onChange={ids => setSettings(s => ({ ...s, recipient_ids: ids }))} /></div>
      <p className="text-xs text-muted-foreground">The daily job follows Pennsylvania dates. Follow-up alerts repeat at most weekly while work remains overdue. Account notification preferences and consent still apply. These settings never change a course deadline.</p>
      {save.isError && <p role="alert" className="text-destructive">{save.error.message}</p>}<Button type="submit">{save.isPending ? "Saving…" : "Save reminder settings"}</Button>
    </fieldset>
  </form>;
}
export function TrainingReportAutomation({ facilityId, filters, onOpen }: { facilityId: string; filters: TrainingEnrollmentFilters; onOpen: (filters: SavedTrainingFilters) => void }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const canManage = ["org_admin", "facility_manager", "platform_admin"].includes(user?.role || "");
  const query = useTrainingAutomation(facilityId, open);
  const save = useSaveTrainingReportSchedule(facilityId);
  const { toast } = useToast();
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<"weekly" | "monthly">("weekly");
  const [day, setDay] = useState(1);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [capturedFilters, setCapturedFilters] = useState<SavedTrainingFilters>();
  const edit = (schedule: TrainingReportSchedule) => { setEditing(schedule.id); setName(schedule.name); setFrequency(schedule.frequency); setDay(schedule.delivery_day); setRecipients(schedule.recipient_ids); setCapturedFilters(schedule.filters); save.reset(); };
  const clear = () => { setEditing(undefined); setName(""); setRecipients([]); setCapturedFilters(undefined); save.reset(); };
  const toggle = (schedule: TrainingReportSchedule) => save.mutate({ id: schedule.id, name: schedule.name, frequency: schedule.frequency, day: schedule.delivery_day, recipients: schedule.recipient_ids, filters: schedule.filters, enabled: !schedule.enabled });
  return <details className="rounded-lg border p-4 space-y-4" onToggle={e => setOpen(e.currentTarget.open)}><summary className="cursor-pointer font-semibold">Reminders & scheduled training reports</summary>
    {query.isError ? <QueryError what="training automation" error={query.error} onRetry={() => void query.refetch()} /> : query.isLoading ? <p>Loading training automation…</p> : query.data && <>
      {canManage ? <><h3 className="font-semibold">Reminder settings</h3><ReminderForm key={JSON.stringify(query.data.settings)} facilityId={facilityId} data={query.data} /></> : <p>Facility administrators manage reminder settings and report subscriptions.</p>}
      <div className="border-t pt-4 space-y-3"><h3 className="font-semibold">Saved report schedules</h3><p className="text-sm text-muted-foreground">Recipients receive a secure link to the saved filters, then view or print the latest authorized records. Reports are live views, not archived snapshots. Delivery follows each account’s channel preferences.</p>
        {query.data.schedules.map(schedule => <div className="border rounded p-3 space-y-2" key={schedule.id}><p className="font-medium">{schedule.name} · {schedule.enabled ? "Active" : "Paused"}</p><p className="text-sm">{schedule.frequency === "weekly" ? `Every ${TRAINING_WEEKDAYS[schedule.delivery_day - 1]}` : `Day ${schedule.delivery_day} each month`} · next run {formatDateForDisplay(schedule.next_run_on)}</p>
          <div className="flex gap-2 flex-wrap"><Button size="sm" variant="outline" onClick={() => onOpen(schedule.filters)}>Open saved report</Button>{canManage && <><Button size="sm" variant="outline" onClick={() => edit(schedule)}>Edit schedule</Button><Button size="sm" variant="outline" disabled={save.isPending} onClick={() => toggle(schedule)}>{schedule.enabled ? "Pause" : "Resume"}</Button></>}</div>
          {schedule.runs.length > 0 && <p className="text-xs text-muted-foreground">Latest run {formatDateForDisplay(schedule.runs[0].scheduled_on)}: {schedule.runs[0].recipient_count} in-app notifications queued. Queueing does not confirm external delivery.</p>}
        </div>)}{!query.data.schedules.length && <p className="text-sm">No scheduled reports yet. Set the report filters above, then save a weekly or monthly schedule.</p>}
        {canManage && <form className="border rounded p-3 space-y-3" onSubmit={e => { e.preventDefault(); save.mutate({ id: editing, name, frequency, day, recipients, filters: capturedFilters ?? saveableTrainingFilters(filters), enabled: true }, { onSuccess: () => { clear(); toast({ title: "Training report schedule saved" }); } }); }}><h4 className="font-semibold">{editing ? "Edit report schedule" : "Schedule the current report"}</h4>
          <fieldset disabled={save.isPending} className="space-y-3"><label className="block">Report name<Input maxLength={120} required value={name} onChange={e => setName(e.target.value)} placeholder="Weekly overdue training" /></label>
            <div className="flex gap-3 flex-wrap"><label className="grid gap-1">Frequency<select className={selectClass} value={frequency} onChange={e => { setFrequency(e.target.value as "weekly" | "monthly"); setDay(1); }}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
              <label className="grid gap-1">Delivery day{frequency === "weekly" ? <select className={selectClass} value={day} onChange={e => setDay(Number(e.target.value))}>{TRAINING_WEEKDAYS.map((label, i) => <option key={label} value={i + 1}>{label}</option>)}</select> : <Input type="number" required min={1} max={28} value={day} onChange={e => setDay(Number(e.target.value))} />}</label></div>
            <div><p className="text-sm font-medium mb-2">Report recipients</p><Recipients recipients={query.data.recipients} selected={recipients} onChange={setRecipients} /></div>
            <p className="text-xs text-muted-foreground">{capturedFilters ? "This edit keeps the schedule’s saved filters." : "The current report filters will be saved, including any exact date range. Clear date fields first for an ongoing report."}</p>
            {capturedFilters && <Button type="button" variant="outline" size="sm" onClick={() => setCapturedFilters(undefined)}>Use current report filters instead</Button>}
            <div className="flex gap-2"><Button type="submit" disabled={!name.trim() || !recipients.length || !trainingScheduleDayIsValid(frequency, day)}>{save.isPending ? "Saving…" : "Save report schedule"}</Button>{editing && <Button type="button" variant="outline" onClick={clear}>Cancel edit</Button>}</div>
          </fieldset>
        </form>}
        {save.isError && <p role="alert" className="text-destructive">{save.error.message}</p>}
      </div>
    </>}
  </details>;
}
