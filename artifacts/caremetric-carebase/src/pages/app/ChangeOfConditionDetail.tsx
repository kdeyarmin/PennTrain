import { useId, useState } from "react";
import { facilityDateTimeLocalToUtcIso } from "@/lib/dateUtils";

import { Link, useParams } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  History,
  Loader2,
  PhoneCall,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  useAddChangeEventMonitoring,
  useCloseResidentChangeEvent,
  useCompleteChangeEventFollowUp,
  useGetResidentChangeEvent,
  useRecordChangeEventNotification,
  useResidentChangeEventActivity,
} from "@/hooks/useResidentChangeEvents";
import { QueryError } from "@/components/QueryState";
import { UnsyncedDraftsPanel } from "@/components/residents/UnsyncedDraftsPanel";
import {
  SYNC_OUTCOME_MESSAGES, useSaveOfflineChangeObservationDraft, useSyncOfflineServiceDraft,
} from "@/hooks/useOfflineServiceDrafts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function personName(person: { first_name: string; last_name: string } | null | undefined): string {
  return person ? `${person.first_name} ${person.last_name}` : "System";
}

function queuePath(role: string | undefined): string {
  return `${role === "employee" ? "/me" : "/app"}/change-of-condition`;
}

export default function ChangeOfConditionDetail() {
  const __fieldIds = useId();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const eventQuery = useGetResidentChangeEvent(id);
  const activity = useResidentChangeEventActivity(id);
  const recordNotification = useRecordChangeEventNotification();
  const addMonitoring = useAddChangeEventMonitoring();
  const saveOfflineObservation = useSaveOfflineChangeObservationDraft();
  const syncOfflineObservation = useSyncOfflineServiceDraft();
  const completeFollowUp = useCompleteChangeEventFollowUp();
  const closeEvent = useCloseResidentChangeEvent();
  const isManager = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const canContribute = user?.role !== "auditor";
  const [notificationParty, setNotificationParty] = useState("provider");
  const [notificationStatus, setNotificationStatus] = useState("completed");
  const [notificationMethod, setNotificationMethod] = useState("phone");
  const [notificationContact, setNotificationContact] = useState("");
  const [notificationNotes, setNotificationNotes] = useState("");
  const [observations, setObservations] = useState("");
  const [monitoringAction, setMonitoringAction] = useState("");
  const [supervisorNotified, setSupervisorNotified] = useState(false);
  const [followUpResult, setFollowUpResult] = useState("");
  const [nextDueAt, setNextDueAt] = useState("");
  const [closureSummary, setClosureSummary] = useState("");

  if (eventQuery.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (eventQuery.isError || !eventQuery.data) return <QueryError what="change-of-condition event" error={eventQuery.error} onRetry={() => eventQuery.refetch()} />;
  const event = eventQuery.data;
  const activityReady = !activity.isLoading && !activity.isError && activity.data !== undefined;
  const openFollowUp = activityReady
    ? activity.data?.followUps.find(followUp => ["open", "overdue"].includes(followUp.status))
    : undefined;
  const overdue = event.status !== "closed" && new Date(event.follow_up_due_at) < new Date();
  const closureBlocked = !activityReady
    || event.provider_notification_status === "pending"
    || event.designated_person_notification_status === "pending"
    || event.incident_decision === "pending"
    || !!openFollowUp;

  const submitNotification = () => {
    recordNotification.mutate({
      eventId: event.id,
      party: notificationParty,
      status: notificationStatus,
      notifiedAt: notificationStatus === "completed" ? new Date().toISOString() : null,
      method: notificationMethod,
      contact: notificationContact,
      notes: notificationNotes,
    }, {
      onSuccess: () => {
        toast({ title: `${humanize(notificationParty)} notification updated` });
        setNotificationNotes("");
        setNotificationContact("");
      },
      onError: (error: Error) => toast({ title: "Couldn't update notification", description: error.message, variant: "destructive" }),
    });
  };

  // Monitoring is a cadence -- "every two hours" -- walked in resident rooms and back hallways,
  // which is where the wifi is worst. An observation that cannot be filed at the bedside is either
  // lost or written up later from memory, so it is captured to an encrypted local draft
  // (BACKLOG.md E5 Tier 3).
  //
  // Employee-only: the offline store is scoped to employee accounts (see
  // register_offline_service_device), and this page is shared with managers at /app.
  const canDraftOffline = user?.role === "employee";

  const resetMonitoringForm = () => {
    setObservations("");
    setMonitoringAction("");
    setSupervisorNotified(false);
  };

  const submitMonitoring = async () => {
    const observedAt = new Date().toISOString();

    // Codex review finding (P1). EVERY employee write goes through the draft + sync path, online or
    // not -- the same rule the caregiver charting surface follows for vital signs, and for the same
    // reason.
    //
    // add_change_event_monitoring takes no idempotency key and has no natural guard: calling it
    // twice simply appends a second monitoring entry and a second immutable-history row. (Tier 1 is
    // safe from this by accident -- record_service_task_response refuses a task that is no longer
    // 'scheduled', so a second apply fails on its own. Nothing here does.)
    //
    // An online call whose HTTP response is lost in transit has already committed, but is
    // indistinguishable client-side from one that never reached PostgreSQL: postgrest-js reports the
    // same empty-code fetch error for both. Falling back to a NEW draft with a NEW idempotency key
    // therefore double-charts the observation on the next sync. Minting the draft -- and therefore
    // its key -- BEFORE the first network attempt is what closes that window: the retry carries the
    // same key, and sync_offline_change_observation_draft's unique (device_id, idempotency_key)
    // collapses it to 'duplicate' instead of a second entry in the resident's record.
    const attemptDirectWrite = async () => {
      try {
        await addMonitoring.mutateAsync({
          eventId: event.id,
          observedAt,
          observations,
          actionTaken: monitoringAction,
          supervisorNotified,
        });
        toast({ title: "Monitoring observation recorded" });
        resetMonitoringForm();
      } catch (error) {
        toast({
          title: "Couldn't record monitoring",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      }
    };

    if (!canDraftOffline) {
      // Managers have no offline store to mint a key in, so this path keeps the direct call it has
      // always had. The lost-response window above is not closable without one.
      if (navigator.onLine === false) {
        toast({
          title: "You are offline",
          description: "This observation can't be recorded until this device is back online.",
          variant: "destructive",
        });
        return;
      }
      await attemptDirectWrite();
      return;
    }

    let draftId: string;
    try {
      const draft = await saveOfflineObservation.mutateAsync({
        eventId: event.id,
        residentDisplayLabel: `${event.resident?.first_name ?? ""} ${event.resident?.last_name ?? ""}`.trim()
          || "This resident",
        eventLabel: humanize(event.category),
        organizationId: event.organization_id,
        facilityId: event.facility_id,
        observedAt,
        observations: observations.trim(),
        actionTaken: monitoringAction.trim() || null,
        supervisorNotified,
      });
      draftId = draft.draftId;
    } catch {
      // No local store (private browsing, quota, a blocked upgrade) means no key can be minted that
      // survives a retry, so the idempotent path is simply unavailable. Refusing the write outright
      // would be worse than the narrow lost-response risk -- the observation is real and the aide is
      // standing at the bedside -- so fall through to the direct call rather than losing it.
      await attemptDirectWrite();
      return;
    }

    // Durably on the device from here on, so the form can clear whatever the network does next.
    resetMonitoringForm();

    if (navigator.onLine === false) {
      toast({
        title: "Saved on this device",
        description: "It will sync when you are back online. It stays here until it does.",
      });
      return;
    }

    try {
      const outcome = await syncOfflineObservation.mutateAsync(draftId);
      if (outcome === "applied" || outcome === "duplicate") {
        toast({ title: "Monitoring observation recorded" });
        return;
      }
      // A real refusal (the event closed, this is not your event) is block-and-flagged in the drafts
      // panel rather than vanishing with the toast, which is the whole point of that panel.
      toast({
        title: "Couldn't record monitoring",
        description: SYNC_OUTCOME_MESSAGES[outcome],
        variant: "destructive",
      });
    } catch {
      // The sync itself failed to reach the server. The draft is already saved and flagged for
      // retry, so this is a status message, not a loss.
      toast({
        title: "Saved on this device",
        description: "It couldn't sync just now. It stays here and will retry.",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2"><Link href={queuePath(user?.role)}><ArrowLeft className="mr-1 h-4 w-4" />Change events</Link></Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{event.resident?.first_name} {event.resident?.last_name} · {humanize(event.category)}</h1>
          <Badge variant="outline">{humanize(event.status)}</Badge>
          {event.emergency_transfer && <Badge variant="destructive">Emergency transfer</Badge>}
        </div>
        <p className="text-muted-foreground">{event.facility?.name} · Room {event.resident?.room ?? "—"} · Identified {new Date(event.identified_at).toLocaleString()} by {personName(event.identified_by)}</p>
      </div>

      {overdue && (
        <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Follow-up is overdue</AlertTitle><AlertDescription>Assigned follow-up was due {new Date(event.follow_up_due_at).toLocaleString()}.</AlertDescription></Alert>
      )}
      <Alert>
        <Stethoscope className="h-4 w-4" />
        <AlertTitle>Guided operational workflow—not diagnosis</AlertTitle>
        <AlertDescription>Record observable facts, actions, notifications, and human decisions. Follow provider direction and emergency procedures.</AlertDescription>
      </Alert>

      <UnsyncedDraftsPanel />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Immediate event record</CardTitle><CardDescription>Facts and actions captured when the change was identified.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div><p className="text-xs uppercase text-muted-foreground">Immediate observations</p><p className="whitespace-pre-wrap">{event.immediate_observations}</p></div>
              <div><p className="text-xs uppercase text-muted-foreground">Immediate action taken</p><p className="whitespace-pre-wrap">{event.immediate_action_taken}</p></div>
              {event.emergency_transfer && <div><p className="text-xs uppercase text-muted-foreground">Emergency transfer</p><p>{event.emergency_transfer_destination} · {event.emergency_transfer_at ? new Date(event.emergency_transfer_at).toLocaleString() : "Time not recorded"}</p></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><PhoneCall className="h-5 w-5" />Notifications</CardTitle><CardDescription>Provider and designated-person contact status, method, contact, and notes.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3"><p className="font-medium">Provider</p><Badge variant="outline" className="mt-1">{humanize(event.provider_notification_status)}</Badge>{event.provider_notification_contact && <p className="mt-2 text-sm">{event.provider_notification_contact} · {event.provider_notification_method}</p>}{event.provider_notification_notes && <p className="text-sm text-muted-foreground">{event.provider_notification_notes}</p>}</div>
                <div className="rounded-md border p-3"><p className="font-medium">Designated person</p><Badge variant="outline" className="mt-1">{humanize(event.designated_person_notification_status)}</Badge>{event.designated_person_notification_contact && <p className="mt-2 text-sm">{event.designated_person_notification_contact} · {event.designated_person_notification_method}</p>}{event.designated_person_notification_notes && <p className="text-sm text-muted-foreground">{event.designated_person_notification_notes}</p>}</div>
              </div>
              {canContribute && event.status !== "closed" && (
                <div className="grid gap-2 border-t pt-4 sm:grid-cols-2">
                  <Select value={notificationParty} onValueChange={setNotificationParty}><SelectTrigger aria-label="Notification party"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="provider">Provider</SelectItem><SelectItem value="designated_person">Designated person</SelectItem></SelectContent></Select>
                  <Select value={notificationStatus} onValueChange={setNotificationStatus}><SelectTrigger aria-label="Notification status"><SelectValue /></SelectTrigger><SelectContent>{["completed", "unable_to_reach", "not_required", "pending"].map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select>
                  <Input value={notificationMethod} onChange={input => setNotificationMethod(input.target.value)} placeholder="Method" />
                  <Input value={notificationContact} onChange={input => setNotificationContact(input.target.value)} placeholder="Contact name / office" />
                  <Textarea className="sm:col-span-2" value={notificationNotes} onChange={input => setNotificationNotes(input.target.value)} placeholder="Notification notes" />
                  <Button className="sm:col-span-2" disabled={recordNotification.isPending || (notificationStatus === "completed" && !notificationContact.trim())} onClick={submitNotification}>Save notification</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Monitoring</CardTitle><CardDescription>{event.monitoring_instructions || "No specific monitoring instructions recorded."}{event.monitoring_frequency ? ` Frequency: ${event.monitoring_frequency}.` : ""}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {canContribute && event.status !== "closed" && (
                <div className="space-y-2">
                  <Textarea value={observations} onChange={input => setObservations(input.target.value)} placeholder="Current observable facts" />
                  <Textarea value={monitoringAction} onChange={input => setMonitoringAction(input.target.value)} placeholder="Action taken, if any" />
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={supervisorNotified} onCheckedChange={value => setSupervisorNotified(value === true)} /><BellRing className="h-4 w-4" />Supervisor notified</label>
                  <Button disabled={observations.trim().length < 3 || addMonitoring.isPending || saveOfflineObservation.isPending || syncOfflineObservation.isPending} onClick={() => void submitMonitoring()}>Record observation</Button>
                </div>
              )}
              {activity.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading monitoring observations…</p>
              ) : activity.data?.monitoring.length ? activity.data.monitoring.map(entry => (
                <div key={entry.id} className="border-t pt-3 text-sm">
                  <div className="flex justify-between gap-3"><p className="font-medium">{personName(entry.recorder)}</p><span className="text-xs text-muted-foreground">{new Date(entry.observed_at).toLocaleString()}</span></div>
                  <p className="mt-1">{entry.observations}</p>{entry.action_taken && <p className="text-muted-foreground">Action: {entry.action_taken}</p>}{entry.supervisor_notified && <Badge variant="outline" className="mt-1">Supervisor notified</Badge>}
                </div>
              )) : <p className="text-sm text-muted-foreground">No monitoring observations recorded yet.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Immutable event history</CardTitle><CardDescription>Creation, notification, monitoring, follow-up, and supervisor decisions.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {activity.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading event history…</p>
              ) : activity.data?.history.map(entry => <div key={entry.id} className="flex justify-between gap-3 border-b pb-2 text-sm"><div><p className="font-medium">{humanize(entry.event_type)}{entry.resulting_status ? ` · ${humanize(entry.resulting_status)}` : ""}</p><p className="text-muted-foreground">{entry.reason}</p><p className="text-xs text-muted-foreground">{personName(entry.actor)}</p></div><span className="shrink-0 text-xs text-muted-foreground">{new Date(entry.occurred_at).toLocaleString()}</span></div>)}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Assigned follow-up</CardTitle><CardDescription>Due {new Date(event.follow_up_due_at).toLocaleString()} · {personName(event.assigned)}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {activity.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading follow-ups…</p>
              ) : activity.data?.followUps.map(followUp => <div key={followUp.id} className="rounded-md border p-3 text-sm"><div className="flex justify-between gap-2"><p className="font-medium">Due {new Date(followUp.due_at).toLocaleString()}</p><Badge variant="outline">{humanize(followUp.status)}</Badge></div><p className="text-xs text-muted-foreground">{personName(followUp.assigned)}</p>{followUp.result && <p className="mt-2">{followUp.result}</p>}</div>)}
              {canContribute && openFollowUp && (
                <div className="space-y-2 border-t pt-3">
                  <Textarea value={followUpResult} onChange={input => setFollowUpResult(input.target.value)} placeholder="Follow-up results" />
                  <div className="space-y-1"><Label htmlFor={`${__fieldIds}-optional-next-follow-up`}>Optional next follow-up</Label><Input id={`${__fieldIds}-optional-next-follow-up`} type="datetime-local" value={nextDueAt} onChange={input => setNextDueAt(input.target.value)} /></div>
                  <Button disabled={followUpResult.trim().length < 3 || completeFollowUp.isPending} onClick={() => completeFollowUp.mutate({ followUpId: openFollowUp.id, result: followUpResult, nextFollowUpDueAt: nextDueAt ? facilityDateTimeLocalToUtcIso(nextDueAt) : null }, { onSuccess: () => { toast({ title: nextDueAt ? "Follow-up completed and next check scheduled" : "Follow-up submitted for supervisor review" }); setFollowUpResult(""); setNextDueAt(""); }, onError: (error: Error) => toast({ title: "Couldn't complete follow-up", description: error.message, variant: "destructive" }) })}>Complete follow-up</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Required decisions</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between"><span>Incident report</span><Badge variant="outline">{humanize(event.incident_decision)}</Badge></div>
              <div className="flex justify-between"><span>Significant-change reassessment</span><Badge variant="outline">{event.reassessment_required ? "Required" : "Not required"}</Badge></div>
              <div className="flex justify-between"><span>Support-plan revision review</span><Badge variant="outline">{event.support_plan_revision_required ? "Required" : "Not required"}</Badge></div>
              {event.incident_id && <Button asChild variant="outline" size="sm" className="w-full"><Link href={`/app/incidents/${event.incident_id}`}>Open linked incident <ExternalLink className="ml-2 h-4 w-4" /></Link></Button>}
              {event.compliance_item_id && <Button asChild variant="outline" size="sm" className="w-full"><Link href="/app/state-forms">Open reassessment workflow <ExternalLink className="ml-2 h-4 w-4" /></Link></Button>}
              <Button asChild variant="outline" size="sm" className="w-full"><Link href={`/app/residents/${event.resident_id}`}>Open resident record <ExternalLink className="ml-2 h-4 w-4" /></Link></Button>
            </CardContent>
          </Card>

          {isManager && event.status === "pending_supervisor_review" && (
            <Card className="border-emerald-300">
              <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Final supervisor review</CardTitle><CardDescription>Closure requires completed follow-ups, notification decisions, and an incident decision.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {closureBlocked && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Closure requirements remain</AlertTitle><AlertDescription>{activity.isLoading ? "Checking follow-ups and closure requirements…" : "Resolve pending notifications, incident decision, and open follow-ups first."}</AlertDescription></Alert>}
                <Textarea value={closureSummary} onChange={input => setClosureSummary(input.target.value)} placeholder="Supervisor review and closure summary" />
                <Button disabled={closureBlocked || closureSummary.trim().length < 5 || closeEvent.isPending} onClick={() => closeEvent.mutate({ eventId: event.id, summary: closureSummary }, { onSuccess: () => toast({ title: "Change event closed after supervisor review" }), onError: (error: Error) => toast({ title: "Couldn't close event", description: error.message, variant: "destructive" }) })}><CheckCircle2 className="mr-2 h-4 w-4" />Close event</Button>
              </CardContent>
            </Card>
          )}

          {event.status === "closed" && (
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" />Closed</CardTitle><CardDescription>{event.closed_at ? new Date(event.closed_at).toLocaleString() : ""}</CardDescription></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm">{event.final_review_summary}</p></CardContent></Card>
          )}
        </div>
      </div>
    </div>
  );
}
