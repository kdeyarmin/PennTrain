import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  MapPin,
  MessageSquareText,
  Printer,
  Radio,
  Siren,
  UserCheck,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useListProfiles } from "@/hooks/useProfiles";
import {
  useAddEmergencyCorrectiveAction,
  useAddEmergencyTimelineEntry,
  useEmergencyEvent,
  useEmergencyReadiness,
  useLogEmergencyCommunication,
  useQueueDesignatedPersonNotifications,
  useRecordEmergencyAccountability,
  useSaveEmergencyAfterAction,
  useTransitionEmergencyEvent,
} from "@/hooks/useEmergencyOperations";
import { useToast } from "@/hooks/use-toast";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const human = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const localDateTime = () => {
  const value = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return value.toISOString().slice(0, 16);
};
const accountabilityStatuses = ["present", "evacuated", "relocated", "sheltering", "not_present", "unaccounted"];

export default function EmergencyEventDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const eventQuery = useEmergencyEvent(id);
  const event = eventQuery.data?.event;
  const readiness = useEmergencyReadiness(event?.facility_id);
  const profiles = useListProfiles({ organizationId: event?.organization_id });
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const record = useRecordEmergencyAccountability();
  const addTimeline = useAddEmergencyTimelineEntry();
  const logCommunication = useLogEmergencyCommunication();
  const queueMass = useQueueDesignatedPersonNotifications();
  const saveReview = useSaveEmergencyAfterAction();
  const addAction = useAddEmergencyCorrectiveAction();
  const transition = useTransitionEmergencyEvent();

  const [timelineType, setTimelineType] = useState("observation");
  const [timelineAt, setTimelineAt] = useState(localDateTime());
  const [timelineDescription, setTimelineDescription] = useState("");
  const [audience, setAudience] = useState("utility");
  const [recipientName, setRecipientName] = useState("");
  const [recipientContact, setRecipientContact] = useState("");
  const [channel, setChannel] = useState("phone");
  const [deliveryStatus, setDeliveryStatus] = useState("confirmed");
  const [communicationMessage, setCommunicationMessage] = useState("");
  const [massChannel, setMassChannel] = useState("phone");
  const [massMessage, setMassMessage] = useState("");
  const [reviewStatus, setReviewStatus] = useState("draft");
  const [responseSummary, setResponseSummary] = useState("");
  const [strengths, setStrengths] = useState("");
  const [gaps, setGaps] = useState("");
  const [lessons, setLessons] = useState("");
  const [correctivePlan, setCorrectivePlan] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [actionOwner, setActionOwner] = useState(user?.id ?? "");
  const [actionPriority, setActionPriority] = useState("high");
  const [actionDueAt, setActionDueAt] = useState(() => {
    const date = new Date(Date.now() + 7 * 86_400_000 - new Date().getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0, 16);
  });
  const [transitionReason, setTransitionReason] = useState("");

  useEffect(() => {
    const review = eventQuery.data?.review;
    if (!review) return;
    setReviewStatus(review.status);
    setResponseSummary(review.response_summary);
    setStrengths(review.strengths ?? "");
    setGaps(review.gaps_identified ?? "");
    setLessons(review.lessons_learned ?? "");
    setCorrectivePlan(review.corrective_action_plan ?? "");
  }, [eventQuery.data?.review]);

  const residentCounts = useMemo(() => {
    const rows = eventQuery.data?.residents ?? [];
    return {
      total: rows.length,
      evacuated: rows.filter((row) => ["evacuated", "relocated"].includes(row.accountability_status)).length,
      assistance: rows.filter((row) => row.assistance_level_snapshot !== "independent").length,
      unaccounted: rows.filter((row) => ["expected", "unaccounted"].includes(row.accountability_status)).length,
    };
  }, [eventQuery.data?.residents]);
  const staffUnaccounted = (eventQuery.data?.staff ?? []).filter((row) => ["expected", "unaccounted"].includes(row.accountability_status)).length;
  const designatedNotified = (eventQuery.data?.communications ?? []).filter(
    (row) => row.audience === "designated_person" && ["sent", "confirmed"].includes(row.delivery_status),
  ).length;
  const openActions = (eventQuery.data?.actions ?? []).filter((row) => {
    const workItem = row.work_item as { state?: string } | null;
    return workItem?.state !== "closed" && workItem?.state !== "canceled";
  }).length;
  const relocationSites = (readiness.data?.resources ?? []).filter(
    (resource) => resource.resource_type === "relocation_site" && resource.is_active,
  );

  if (eventQuery.isLoading) return <p>Loading emergency command…</p>;
  if (eventQuery.isError || !event) return <QueryError what="emergency event" error={eventQuery.error} />;

  const mutationError = (title: string) => (error: Error) =>
    toast({ title, description: error.message, variant: "destructive" });

  const updateAccountability = (
    subjectType: "resident" | "staff",
    subjectId: string,
    status: string,
    relocationSiteId?: string,
  ) => record.mutate(
    { eventId: id, subjectType, subjectId, status, relocationSiteId },
    {
      onSuccess: () => toast({ title: `${human(subjectType)} accountability updated` }),
      onError: mutationError("Could not update accountability"),
    },
  );

  const submitTimeline = () => addTimeline.mutate(
      occurredAt: new Date(timelineAt || Date.now()).toISOString(),
    },
    {
      onSuccess: () => {
        toast({ title: "Timeline entry added" });
        setTimelineDescription("");
      },
      onError: mutationError("Could not add timeline entry"),
    },
  );

  const submitCommunication = () => logCommunication.mutate(
    { eventId: id, audience, recipientName, recipientContact, channel, deliveryStatus, message: communicationMessage },
    {
      onSuccess: () => {
        toast({ title: "Communication logged" });
        setCommunicationMessage("");
      },
      onError: mutationError("Could not log communication"),
    },
  );

  const submitReview = () => saveReview.mutate(
    {
      eventId: id,
      status: reviewStatus,
      responseSummary,
      strengths,
      gapsIdentified: gaps,
      lessonsLearned: lessons,
      correctiveActionPlan: correctivePlan,
    },
    {
      onSuccess: () => toast({ title: `After-action review ${reviewStatus}` }),
      onError: mutationError("Could not save after-action review"),
    },
  );

  const submitAction = () => addAction.mutate(
    {
      eventId: id,
      dueAt: new Date(actionDueAt || Date.now()).toISOString(),
    {
      onSuccess: () => {
        toast({ title: "Corrective work created" });
        setActionTitle("");
        setActionDescription("");
      },
      onError: mutationError("Could not create corrective work"),
    },
  );

  const transitionTo = (targetStatus: string) => transition.mutate(
    { eventId: id, targetStatus, reason: transitionReason },
    {
      onSuccess: () => {
        toast({ title: `Event marked ${human(targetStatus)}` });
        setTransitionReason("");
      },
      onError: mutationError("Could not transition emergency event"),
    },
  );

  return (
    <div className="space-y-6 print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="print:hidden">
            <Link href="/app/emergency"><ArrowLeft className="mr-1 h-4 w-4" /> Emergency Operations</Link>
          </Button>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Siren className="h-6 w-6" /> {event.event_number} · {human(event.event_type)}</h1>
          <p className="text-muted-foreground">
            {event.facility?.name} · {human(event.event_mode)} · started {new Date(event.started_at).toLocaleString()} · plan v{event.plan_version?.version_number}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge className="h-fit">{human(event.status)}</Badge>
          <Button variant="outline" onClick={() => window.print()} className="print:hidden"><Printer className="mr-2 h-4 w-4" /> Print emergency packet</Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-4">
          <div><Label>Situation</Label><p>{event.summary}</p></div>
          <div><Label>Location</Label><p>{event.location_description || "—"}</p></div>
          <div><Label>Assembly point</Label><p>{event.assembly_point || "—"}</p></div>
          <div><Label>Incident commander</Label><p>{event.commander ? `${event.commander.first_name} ${event.commander.last_name}` : "Not assigned"}</p></div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        {[
          [Users, residentCounts.total, "In building roster"],
          [UserCheck, residentCounts.evacuated, "Evacuated / relocated"],
          [ClipboardCheck, residentCounts.assistance, "Require assistance"],
          [Siren, residentCounts.unaccounted, "Residents unaccounted"],
          [Users, staffUnaccounted, "Staff unaccounted"],
          [MessageSquareText, designatedNotified, "Designated persons notified"],
          [CheckCircle2, openActions, "Corrective actions open"],
        ].map(([Icon, value, label]) => {
          const MetricIcon = Icon as typeof Siren;
          return <Card key={String(label)}><CardContent className="pt-5"><MetricIcon className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-2xl font-bold">{String(value)}</p><p className="text-xs text-muted-foreground">{String(label)}</p></CardContent></Card>;
        })}
      </div>

      {canManage && !["closed", "canceled"].includes(event.status) && (
        <Card className="print:hidden">
          <CardHeader><CardTitle>Command transition</CardTitle><CardDescription>Stabilization requires every resident and staff member to be accounted for. Closure also requires approved after-action review.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Input className="min-w-[280px] flex-1" placeholder="Required transition reason" value={transitionReason} onChange={(e) => setTransitionReason(e.target.value)} />
            {event.status === "active" && <Button disabled={!transitionReason} onClick={() => transitionTo("stabilized")}>Mark stabilized</Button>}
            {event.status === "stabilized" && <Button disabled={!transitionReason} onClick={() => transitionTo("closed")}>Close after review</Button>}
            <Button variant="destructive" disabled={!transitionReason} onClick={() => transitionTo("canceled")}>Cancel</Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="residents" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap print:hidden">
          <TabsTrigger value="residents">Resident accountability</TabsTrigger>
          <TabsTrigger value="staff">Staff accountability</TabsTrigger>
          <TabsTrigger value="timeline">Timeline & communications</TabsTrigger>
          <TabsTrigger value="review">After-action & corrective work</TabsTrigger>
        </TabsList>

        <TabsContent value="residents">
          <Card>
            <CardHeader><CardTitle>Resident evacuation roster</CardTitle><CardDescription>Who was present, who required assistance, where each resident relocated, and who remains unaccounted for.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {eventQuery.data?.residents.map((resident) => (
                <div key={resident.id} className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[1.3fr_1fr_180px_200px] lg:items-center">
                  <div><p className="font-semibold">{resident.resident_name_snapshot} · Room {resident.room_snapshot || "—"}</p><p className="text-sm text-muted-foreground">{human(resident.assistance_level_snapshot)} · {resident.mobility_needs_snapshot || "No mobility note"}</p><p className="text-xs text-muted-foreground">Transport: {resident.transportation_needs_snapshot || "Not specified"} · Method: {resident.evacuation_method_snapshot || "Not specified"}</p></div>
                  <div className="text-sm"><p>{resident.relocation_site ? `Relocated: ${resident.relocation_site.name}` : "No relocation site"}</p><p className="text-muted-foreground">Equipment: {resident.required_equipment_snapshot || "None recorded"}</p></div>
                  <Badge variant={["expected", "unaccounted"].includes(resident.accountability_status) ? "destructive" : "outline"}>{human(resident.accountability_status)}</Badge>
                  {canManage && !["closed", "canceled"].includes(event.status) && (
                    <div className="space-y-2 print:hidden">
                      <Select value={resident.accountability_status} onValueChange={(status) => updateAccountability("resident", resident.resident_id, status, resident.relocation_site_id ?? undefined)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{accountabilityStatuses.map((status) => <SelectItem key={status} value={status}>{human(status)}</SelectItem>)}</SelectContent></Select>
                      <Select value={resident.relocation_site_id ?? "none"} onValueChange={(siteId) => updateAccountability("resident", resident.resident_id, siteId === "none" ? resident.accountability_status : "relocated", siteId === "none" ? undefined : siteId)}><SelectTrigger><SelectValue placeholder="Relocation site" /></SelectTrigger><SelectContent><SelectItem value="none">No relocation site</SelectItem>{relocationSites.map((site) => <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>)}</SelectContent></Select>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="staff">
          <Card>
            <CardHeader><CardTitle>Staff accountability & responsibilities</CardTitle><CardDescription>Scheduled and standing emergency-assignment roster as snapshotted at declaration.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {eventQuery.data?.staff.map((staff) => (
                <div key={staff.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_1fr_160px] md:items-center">
                  <div><p className="font-semibold">{staff.employee_name_snapshot}</p><p className="text-sm text-muted-foreground">{staff.job_title_snapshot || "—"} · {human(staff.roster_source)}</p></div>
                  <p className="text-sm">{staff.responsibility_snapshot || "No command responsibility assigned"}</p>
                  {canManage && !["closed", "canceled"].includes(event.status) ? (
                    <Select value={staff.accountability_status} onValueChange={(status) => updateAccountability("staff", staff.employee_id, status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{accountabilityStatuses.map((status) => <SelectItem key={status} value={status}>{human(status)}</SelectItem>)}</SelectContent></Select>
                  ) : <Badge variant={["expected", "unaccounted"].includes(staff.accountability_status) ? "destructive" : "outline"}>{human(staff.accountability_status)}</Badge>}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" /> Event timeline</CardTitle><CardDescription>Append-only decisions, observations, movements, and resource updates.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {eventQuery.data?.timeline.map((entry) => (
                  <div key={entry.id} className="border-l-2 pl-3"><div className="flex justify-between gap-2"><Badge variant="outline">{human(entry.event_type)}</Badge><span className="text-xs text-muted-foreground">{new Date(entry.occurred_at).toLocaleString()}</span></div><p className="mt-1 text-sm">{entry.description}</p></div>
                ))}
                {canManage && !["closed", "canceled"].includes(event.status) && <div className="space-y-2 border-t pt-3 print:hidden"><div className="grid gap-2 sm:grid-cols-2"><Select value={timelineType} onValueChange={setTimelineType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["observation","decision","resource","evacuation","relocation","other"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select><Input type="datetime-local" value={timelineAt} onChange={(e) => setTimelineAt(e.target.value)} /></div><Textarea placeholder="Timeline description" value={timelineDescription} onChange={(e) => setTimelineDescription(e.target.value)} /><Button disabled={!timelineDescription} onClick={submitTimeline}>Add timeline entry</Button></div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Radio className="h-5 w-5" /> Communication log</CardTitle><CardDescription>Family/designated-person, staff, utility, vendor, and emergency-service contacts.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {eventQuery.data?.communications.map((communication) => (
                  <div key={communication.id} className="rounded border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{communication.recipient_name_snapshot || human(communication.audience)}</p><div className="flex gap-1"><Badge variant="outline">{human(communication.channel)}</Badge><Badge>{human(communication.delivery_status)}</Badge></div></div><p>{communication.message}</p><p className="text-xs text-muted-foreground">{communication.recipient_contact_snapshot || "No contact snapshot"} · {new Date(communication.occurred_at).toLocaleString()}</p></div>
                ))}
                {canManage && !["closed", "canceled"].includes(event.status) && <div className="space-y-2 border-t pt-3 print:hidden"><Label>Family/designated-person mass notification</Label><div className="flex gap-2"><Select value={massChannel} onValueChange={setMassChannel}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="phone">Phone</SelectItem><SelectItem value="sms">SMS queue</SelectItem><SelectItem value="email">Email queue</SelectItem></SelectContent></Select><Input placeholder="Notification message" value={massMessage} onChange={(e) => setMassMessage(e.target.value)} /></div><Button variant="outline" disabled={!massMessage} onClick={() => queueMass.mutate({ eventId: id, message: massMessage, channel: massChannel }, { onSuccess: (result) => toast({ title: "Notification batch queued", description: `${(result as { recipientCount?: number } | null)?.recipientCount ?? 0} contacts recorded.` }), onError: mutationError("Could not queue notification batch") })}>Queue designated-person batch</Button><div className="grid gap-2 sm:grid-cols-2"><Select value={audience} onValueChange={setAudience}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["family","designated_person","staff","resident","vendor","utility","emergency_services","other"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select><Select value={deliveryStatus} onValueChange={setDeliveryStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["queued","attempted","sent","confirmed","failed","not_required"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select><Input placeholder="Recipient name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} /><Input placeholder="Contact" value={recipientContact} onChange={(e) => setRecipientContact(e.target.value)} /><Select value={channel} onValueChange={setChannel}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["phone","sms","email","in_person","radio","other"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select></div><Textarea placeholder="Communication message" value={communicationMessage} onChange={(e) => setCommunicationMessage(e.target.value)} /><Button disabled={!communicationMessage} onClick={submitCommunication}>Log communication</Button></div>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="review" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>After-action review</CardTitle><CardDescription>Approval is required before formal event closure.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1"><Label>Status</Label><Select value={reviewStatus} onValueChange={setReviewStatus} disabled={!canManage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["draft","submitted","approved"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1 md:col-span-2"><Label>Response summary</Label><Textarea value={responseSummary} onChange={(e) => setResponseSummary(e.target.value)} readOnly={!canManage} /></div>
              <div className="space-y-1"><Label>Strengths</Label><Textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} readOnly={!canManage} /></div>
              <div className="space-y-1"><Label>Gaps identified</Label><Textarea value={gaps} onChange={(e) => setGaps(e.target.value)} readOnly={!canManage} /></div>
              <div className="space-y-1"><Label>Lessons learned</Label><Textarea value={lessons} onChange={(e) => setLessons(e.target.value)} readOnly={!canManage} /></div>
              <div className="space-y-1"><Label>Corrective-action plan</Label><Textarea value={correctivePlan} onChange={(e) => setCorrectivePlan(e.target.value)} readOnly={!canManage} /></div>
              {canManage && <Button className="md:col-span-2 print:hidden" disabled={!responseSummary} onClick={submitReview}>Save / approve after-action review</Button>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Corrective actions</CardTitle><CardDescription>Actions use the shared operational work queue and remain open after the event itself closes.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {eventQuery.data?.actions.map((action) => {
                const workItem = action.work_item as { id: string; title: string; state: string; priority: string; due_at: string } | null;
                return workItem && <div key={action.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"><div><p className="font-medium">{workItem.title}</p><p className="text-xs text-muted-foreground">Due {new Date(workItem.due_at).toLocaleString()}</p></div><div className="flex gap-2"><Badge variant="outline">{human(workItem.priority)}</Badge><Badge>{human(workItem.state)}</Badge><Button asChild variant="outline" size="sm"><Link href={`/app/work/${workItem.id}`}>Open work item</Link></Button></div></div>;
              })}
              {canManage && <div className="grid gap-2 border-t pt-3 md:grid-cols-2 print:hidden"><Input placeholder="Corrective action title" value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} /><Select value={actionOwner} onValueChange={setActionOwner}><SelectTrigger><SelectValue placeholder="Owner" /></SelectTrigger><SelectContent>{profiles.data?.filter((profile) => profile.is_active).map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</SelectItem>)}</SelectContent></Select><Textarea className="md:col-span-2" placeholder="Description" value={actionDescription} onChange={(e) => setActionDescription(e.target.value)} /><Select value={actionPriority} onValueChange={setActionPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["low","normal","high","urgent"].map((value) => <SelectItem key={value} value={value}>{human(value)}</SelectItem>)}</SelectContent></Select><Input type="datetime-local" value={actionDueAt} onChange={(e) => setActionDueAt(e.target.value)} /><Button className="md:col-span-2" disabled={!actionTitle || !actionOwner} onClick={submitAction}>Create corrective work item</Button></div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
