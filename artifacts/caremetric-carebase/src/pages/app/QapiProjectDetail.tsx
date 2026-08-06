import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, ClipboardCheck, Printer, Target } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useListProfiles } from "@/hooks/useProfiles";
import {
  useAddQapiAction,
  useAddQapiMeeting,
  useGetQapiProject,
  useQapiProjectActivity,
  useRecordQapiMeasurement,
  useUpdateQapiPlan,
} from "@/hooks/useQapi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { QueryError } from "@/components/QueryState";
// toDateTimeLocal, because `new Date(...).toISOString().slice(0, 16)` is a UTC wall clock and a
// datetime-local input renders whatever it is given as LOCAL time. The two defaults below were
// therefore drawn four or five hours ahead of the moment they meant: at 21:30 ET the "held at"
// field opened on 01:30 the NEXT day, and submitting it recorded a QAPI meeting as held in the
// future, on the wrong date. Reading back was already local (`new Date(held)`), so the round
// trip disagreed with itself.
import { facilityToday, toDateTimeLocal, facilityDateTimeLocalToUtcIso} from "@/lib/dateUtils";
import type { Json } from "@/lib/database.types";

const human = (v: string) =>
    v.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
  today = () => facilityToday();
export default function QapiProjectDetail() {
  const { id } = useParams<{ id: string }>(),
    { user } = useAuth(),
    { toast } = useToast(),
    project = useGetQapiProject(id),
    activity = useQapiProjectActivity(id),
    profiles = useListProfiles({
      organizationId: user?.organizationId ?? undefined,
    }),
    update = useUpdateQapiPlan(),
    addAction = useAddQapiAction(),
    measure = useRecordQapiMeasurement(),
    meeting = useAddQapiMeeting();
  const p = project.data;
  const [status, setStatus] = useState("active"),
    [method, setMethod] = useState("five_whys"),
    [root, setRoot] = useState(""),
    [interventions, setInterventions] = useState(""),
    [frequency, setFrequency] = useState("monthly"),
    [sample, setSample] = useState(""),
    [barriers, setBarriers] = useState(""),
    [adjustments, setAdjustments] = useState(""),
    [effectiveness, setEffectiveness] = useState(""),
    [sustainment, setSustainment] = useState(""),
    [reason, setReason] = useState("QAPI plan updated");
  const [aTitle, setATitle] = useState(""),
    [aDesc, setADesc] = useState(""),
    [aOwner, setAOwner] = useState(user?.id ?? ""),
    [aDue, setADue] = useState(toDateTimeLocal(new Date(Date.now() + 14 * 864e5)));
  const [num, setNum] = useState(""),
    [den, setDen] = useState(""),
    [mNotes, setMNotes] = useState(""),
    [mSample, setMSample] = useState(""),
    [held, setHeld] = useState(toDateTimeLocal()),
    [attendees, setAttendees] = useState(""),
    [meetingNotes, setMeetingNotes] = useState("");
  const [team, setTeam] = useState<Json>([]);
  // Hydrate the plan form from the loaded project.
  //
  // Without this the fields sat at their hardcoded initial values no matter which project was
  // open, and `save` sends every one of them: update_qapi_project_plan is a straight
  // `update ... set` with `nullif(btrim(...),'')`, not a coalesce-to-existing. So pressing "Save
  // plan" on an existing project -- to change one field, or after adding an action item -- wrote
  // status back to 'active' (regressing a monitoring or pending_closure project and losing the
  // closure gate it had reached), reset the method to five_whys and the frequency to monthly,
  // blanked team_members to [], and NULLed the root-cause analysis, planned interventions, audit
  // sample, barriers, adjustments, effectiveness determination and sustainment period. That is
  // the narrative body of a regulatory quality-improvement record.
  //
  // Depends on the project id, NOT on `p` itself: every QAPI mutation on this page invalidates the
  // project query, so re-seeding on each new object identity would wipe whatever the user had
  // typed but not yet saved the moment they added an action item or logged a measurement.
  useEffect(() => {
    if (!p) return;
    setStatus(p.status ?? "active");
    setMethod(p.root_cause_method ?? "five_whys");
    setRoot(p.root_cause_analysis ?? "");
    setInterventions(p.planned_interventions ?? "");
    setFrequency(p.measurement_frequency ?? "monthly");
    setSample(p.audit_sample ?? "");
    setBarriers(p.barriers ?? "");
    setAdjustments(p.adjustments ?? "");
    setEffectiveness(p.effectiveness_determination ?? "");
    setSustainment(p.sustainment_period ?? "");
    setTeam((p.team_members ?? []) as Json);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id]);
  if (project.isLoading) return <p>Loading…</p>;
  if (project.isError || !p)
    return <QueryError what="QAPI project" error={project.error} />;
  const save = () =>
    update.mutate(
      {
        id: p.id,
        status,
        // The project's existing team, not a fresh []. The RPC assigns team_members outright
        // (`coalesce(p_team_members,'[]')`), so sending a literal [] cleared it on every save.
        team,
        method,
        root,
        interventions,
        frequency,
        sample,
        barriers,
        adjustments,
        effectiveness,
        sustainment,
        reason,
      },
      {
        onSuccess: () => toast({ title: "QAPI plan updated" }),
        onError: (e: Error) =>
          toast({
            title: "Could not update plan",
            description: e.message,
            variant: "destructive",
          }),
      },
    );
  return (
    <div className="space-y-6 print:p-0">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="print:hidden">
            <Link href="/app/qapi">
              <ArrowLeft className="mr-1 h-4 w-4" />
              QAPI
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">
            {p.project_number} · {p.title}
          </h1>
          <p className="text-muted-foreground">
            {p.facility?.name} · Lead{" "}
            {p.lead ? `${p.lead.first_name} ${p.lead.last_name}` : "Unassigned"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{human(p.status)}</Badge>
          <Button
            className="print:hidden"
            variant="outline"
            onClick={() => window.print()}
          >
            <Printer className="mr-2 h-4 w-4" />
            Print QAPI book report
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Problem, baseline & objective</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium leading-none">Problem statement</p>
            <p>{p.problem_statement}</p>
          </div>
          <div>
            <p className="text-sm font-medium leading-none">Source of concern</p>
            <p>{p.source_of_concern}</p>
          </div>
          <div>
            <p className="text-sm font-medium leading-none">Baseline</p>
            <p>{p.baseline_data || "—"}</p>
          </div>
          <div>
            <p className="text-sm font-medium leading-none">Measurable objective / target</p>
            <p>
              {p.measurable_objective || "—"} · {p.target_description || "—"}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Project plan and lifecycle</CardTitle>
          <CardDescription>
            Five-Whys/fishbone analysis, interventions, barriers, adjustments,
            effectiveness, and sustainment.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                "proposed",
                "active",
                "monitoring",
                "pending_closure",
                "closed",
                "canceled",
              ].map((v) => (
                <SelectItem key={v} value={v}>
                  {human(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="five_whys">Five Whys</SelectItem>
              <SelectItem value="fishbone">Fishbone</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            className="md:col-span-2"
            placeholder="Root-cause analysis"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
          />
          <Textarea
            className="md:col-span-2"
            placeholder="Planned interventions"
            value={interventions}
            onChange={(e) => setInterventions(e.target.value)}
          />
          <Input
            placeholder="Measurement frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
          />
          <Input
            placeholder="Audit sample"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
          />
          <Textarea
            placeholder="Barriers"
            value={barriers}
            onChange={(e) => setBarriers(e.target.value)}
          />
          <Textarea
            placeholder="Adjustments"
            value={adjustments}
            onChange={(e) => setAdjustments(e.target.value)}
          />
          <Textarea
            placeholder="Effectiveness determination"
            value={effectiveness}
            onChange={(e) => setEffectiveness(e.target.value)}
          />
          <Input
            placeholder="Sustainment period"
            value={sustainment}
            onChange={(e) => setSustainment(e.target.value)}
          />
          <Input
            className="md:col-span-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button className="md:col-span-2" onClick={save}>
            Save plan / transition
          </Button>
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Action items</CardTitle>
            <CardDescription>
              Actions are owned work items with due dates, approval, documentation,
              and effectiveness.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.data?.actions.map((a: any) => (
              <div key={a.id} className="rounded border p-3">
                <p className="font-medium">{a.work_item?.title}</p>
                <Badge variant="outline">
                  {human(a.work_item?.state ?? "")}
                </Badge>
              </div>
            ))}
            <div className="space-y-2 print:hidden">
              <Input
                placeholder="Action title"
                value={aTitle}
                onChange={(e) => setATitle(e.target.value)}
              />
              <Textarea
                placeholder="Action description"
                value={aDesc}
                onChange={(e) => setADesc(e.target.value)}
              />
              <Select value={aOwner} onValueChange={setAOwner}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.data?.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.first_name} {x.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="datetime-local"
                value={aDue}
                onChange={(e) => setADue(e.target.value)}
              />
              <Button
                disabled={!aTitle || !aDue}
                onClick={() =>
                  addAction.mutate(
                    {
                      id: p.id,
                      title: aTitle,
                      description: aDesc,
                      type: "systemic",
                      owner: aOwner,
                      due: facilityDateTimeLocalToUtcIso(aDue),
                    },
                    {
                      onSuccess: () => {
                        toast({ title: "Action added" });
                        setATitle("");
                      },
                    },
                  )
                }
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                Add owned action
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Measurements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.data?.measurements.map((m: any) => (
              <div key={m.id} className="rounded border p-3">
                <p className="font-medium">
                  {m.period_start}–{m.period_end}: {m.result_value}
                </p>
                <p className="text-sm text-muted-foreground">
                  {m.result_notes}
                </p>
              </div>
            ))}
            <div className="grid gap-2 sm:grid-cols-2 print:hidden">
              <Input
                type="number"
                placeholder="Numerator"
                value={num}
                onChange={(e) => setNum(e.target.value)}
              />
              <Input
                type="number"
                placeholder="Denominator (optional)"
                value={den}
                onChange={(e) => setDen(e.target.value)}
              />
              <Input
                placeholder="Audit sample"
                value={mSample}
                onChange={(e) => setMSample(e.target.value)}
              />
              <Input
                placeholder="Result notes"
                value={mNotes}
                onChange={(e) => setMNotes(e.target.value)}
              />
              <Button
                className="sm:col-span-2"
                disabled={!num}
                onClick={() =>
                  measure.mutate(
                    {
                      id: p.id,
                      start: today(),
                      end: today(),
                      numerator: Number(num),
                      denominator: den ? Number(den) : undefined,
                      notes: mNotes,
                      sample: mSample,
                    },
                    {
                      onSuccess: () => toast({ title: "Measurement recorded" }),
                    },
                  )
                }
              >
                <Target className="mr-2 h-4 w-4" />
                Record measurement
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>QAPI meeting notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {activity.data?.meetings.map((m: any) => (
            <div key={m.id} className="rounded border p-3">
              <p className="font-medium">
                {new Date(m.held_at).toLocaleString()} · {m.attendees}
              </p>
              <p>{m.notes}</p>
            </div>
          ))}
          <div className="grid gap-2 md:grid-cols-2 print:hidden">
            <Input
              type="datetime-local"
              value={held}
              onChange={(e) => setHeld(e.target.value)}
            />
            <Input
              placeholder="Attendees"
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
            />
            <Textarea
              className="md:col-span-2"
              placeholder="Meeting notes"
              value={meetingNotes}
              onChange={(e) => setMeetingNotes(e.target.value)}
            />
            <Button
              className="md:col-span-2"
              disabled={!attendees || !meetingNotes || !held}
              onClick={() =>
                meeting.mutate(
                  {
                    id: p.id,
                    held: facilityDateTimeLocalToUtcIso(held),
                    attendees,
                    notes: meetingNotes,
                    barriers,
                    adjustments,
                  },
                  { onSuccess: () => toast({ title: "Meeting note added" }) },
                )
              }
            >
              Add meeting note
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
