import { useState } from "react";
import { AlertTriangle, ClipboardList, Eye, FileCheck2, Loader2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import {
  useRecordSurveyDayObservation,
  useRecordSurveyDayPacketAssembled,
  useRecordSurveyDayRequest,
  useRecordSurveyDaySurveyor,
  useResolveSurveyDayRequest,
  useSurveyDayPacket,
  type SurveyDayEntryType,
  type SurveyDayFindingDisposition,
  type SurveyDayPacket,
  type SurveyDayRequestStatus,
} from "@/hooks/useSurveyDay";

function displayTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The live Survey Day log and the packet it assembles into (program plan Phase 10a, request item 23).
 *
 * WHY THIS IS SEPARATE FROM THE ENTRANCE-CONFERENCE CHECKLIST. The checklist is what the facility
 * predicted would be asked for and prepared in advance. This is what was actually asked for, by whom,
 * with a deadline — plus who was interviewed, what was observed, and what the surveyor flagged. The
 * two are different records and collapsing them would lose the clock, which is the part that matters
 * while surveyors are still in the building.
 *
 * NOTHING HERE PRODUCES A DETERMINATION. A potential finding is recorded with the facility's own
 * disposition and, where disputed, the facility's stated basis. The product never decides whether a
 * finding is valid.
 */
export default function SurveyDayLogSection({ sessionId, readOnly }: {
  sessionId: string;
  readOnly: boolean;
}) {
  const packet = useSurveyDayPacket(sessionId);

  if (packet.isLoading) return <QueryLoading what="the survey log" />;
  if (packet.isError) {
    return (
      <QueryError
        what="the survey log"
        error={packet.error as Error}
        onRetry={() => packet.refetch()}
      />
    );
  }
  const data = packet.data!;

  return (
    <div className="space-y-6">
      <SurveyorsCard sessionId={sessionId} packet={data} readOnly={readOnly} />
      <RequestsCard sessionId={sessionId} packet={data} readOnly={readOnly} />
      <ObservationsCard sessionId={sessionId} packet={data} readOnly={readOnly} />
      <PacketCard sessionId={sessionId} packet={data} readOnly={readOnly} />
    </div>
  );
}

function SurveyorsCard({ sessionId, packet, readOnly }: {
  sessionId: string; packet: SurveyDayPacket; readOnly: boolean;
}) {
  const { toast } = useToast();
  const record = useRecordSurveyDaySurveyor();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [agency, setAgency] = useState("PA DHS");
  const [isLead, setIsLead] = useState(false);

  const submit = () => record.mutate(
    { sessionId, name: name.trim(), title: title.trim(), agency: agency.trim(), isLead },
    {
      onSuccess: () => { setName(""); setTitle(""); setIsLead(false); },
      onError: (e: Error) => toast({ title: "Could not record the surveyor", description: e.message, variant: "destructive" }),
    },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" />Who is here</CardTitle>
        <CardDescription>
          The surveyors on site and when each arrived. Recorded so that requests and observations can be
          attributed to the person who made them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {packet.surveyors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No surveyors recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {packet.surveyors.map((surveyor) => (
              <li key={surveyor.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                <span className="font-medium">{surveyor.name}</span>
                {surveyor.isLead && <Badge variant="secondary">Lead</Badge>}
                <span className="text-sm text-muted-foreground">
                  {[surveyor.title, surveyor.agency].filter(Boolean).join(" · ") || "No title recorded"}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  Arrived {displayTime(surveyor.arrivedAt)}
                  {surveyor.departedAt ? ` · departed ${displayTime(surveyor.departedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <div className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="surveyor-name">Name</Label>
              <Input id="surveyor-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Surveyor name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="surveyor-title">Title</Label>
              <Input id="surveyor-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Licensing Representative" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="surveyor-agency">Agency</Label>
              <Input id="surveyor-agency" value={agency} onChange={(e) => setAgency(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox id="surveyor-lead" checked={isLead} onCheckedChange={(v) => setIsLead(v === true)} />
              <Label htmlFor="surveyor-lead" className="font-normal">Lead surveyor</Label>
            </div>
            <Button disabled={name.trim().length < 2 || record.isPending} onClick={submit}>
              {record.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record surveyor
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const REQUEST_STATUS_LABEL: Record<SurveyDayRequestStatus, string> = {
  open: "Open",
  provided: "Provided",
  unavailable: "Not available",
  withdrawn: "Withdrawn",
};

function RequestsCard({ sessionId, packet, readOnly }: {
  sessionId: string; packet: SurveyDayPacket; readOnly: boolean;
}) {
  const { toast } = useToast();
  const record = useRecordSurveyDayRequest();
  const resolve = useResolveSurveyDayRequest();
  const [text, setText] = useState("");
  const [surveyorId, setSurveyorId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState<Exclude<SurveyDayRequestStatus, "open">>("provided");
  const [note, setNote] = useState("");

  const submit = () => record.mutate(
    {
      sessionId,
      requestText: text.trim(),
      surveyorId: surveyorId || undefined,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
    },
    {
      onSuccess: () => { setText(""); setDueAt(""); },
      onError: (e: Error) => toast({ title: "Could not record the request", description: e.message, variant: "destructive" }),
    },
  );

  const submitResolution = (requestId: string) => resolve.mutate(
    { sessionId, requestId, status: resolveStatus, note: note.trim() },
    {
      onSuccess: () => { setResolving(null); setNote(""); setResolveStatus("provided"); },
      onError: (e: Error) => toast({ title: "Could not resolve the request", description: e.message, variant: "destructive" }),
    },
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />What was asked for</CardTitle>
            <CardDescription>
              Every document and record a surveyor requested, with its deadline and who owns it.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline">{packet.openRequests} open</Badge>
            {packet.overdueRequests > 0 && (
              <Badge variant="outline" className="border-destructive text-destructive">
                {packet.overdueRequests} past deadline
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {packet.requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has been requested yet.</p>
        ) : (
          <ul className="space-y-2">
            {packet.requests.map((request) => {
              const overdue = request.status === "open" && !!request.dueAt && new Date(request.dueAt) < new Date();
              return (
                <li key={request.id} className={`rounded-md border p-3 ${overdue ? "border-destructive" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm">{request.request}</p>
                    <Badge variant={request.status === "open" ? "outline" : "secondary"}>
                      {REQUEST_STATUS_LABEL[request.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Asked {displayTime(request.requestedAt)}
                    {request.dueAt ? ` · due ${displayTime(request.dueAt)}` : " · no deadline given"}
                    {request.assignedTo ? ` · ${request.assignedTo}` : ""}
                  </p>
                  {request.providedNote && (
                    <p className="mt-1 text-xs">
                      <span className="text-muted-foreground">Resolved {displayTime(request.providedAt)}: </span>
                      {request.providedNote}
                    </p>
                  )}

                  {!readOnly && request.status === "open" && (
                    resolving === request.id ? (
                      <div className="mt-2 space-y-2 rounded-md border border-dashed p-2">
                        <Select value={resolveStatus} onValueChange={(v) => setResolveStatus(v as Exclude<SurveyDayRequestStatus, "open">)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="provided">Provided</SelectItem>
                            <SelectItem value="unavailable">Not available</SelectItem>
                            <SelectItem value="withdrawn">Withdrawn by the surveyor</SelectItem>
                          </SelectContent>
                        </Select>
                        {/* "We could not produce it" is exactly what a finding gets written from, so the
                            reason is required in every direction, not only for "provided". */}
                        <Textarea
                          rows={2}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="What was handed over, or why it could not be — required"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={note.trim().length === 0 || resolve.isPending}
                            onClick={() => submitResolution(request.id)}
                          >
                            {resolve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setResolving(null); setNote(""); }}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => setResolving(request.id)}>
                        Resolve
                      </Button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!readOnly && (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <Label htmlFor="request-text">New request</Label>
            <Textarea
              id="request-text"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What the surveyor asked for, in their words"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="request-surveyor">Requested by</Label>
                <Select value={surveyorId} onValueChange={setSurveyorId}>
                  <SelectTrigger id="request-surveyor"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {packet.surveyors.map((surveyor) => (
                      <SelectItem key={surveyor.id} value={surveyor.id}>{surveyor.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="request-due">Deadline</Label>
                <Input id="request-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </div>
            </div>
            <Button disabled={text.trim().length < 3 || record.isPending} onClick={submit}>
              {record.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record request
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const DISPOSITION_LABEL: Record<SurveyDayFindingDisposition, string> = {
  potential: "Potential",
  accepted: "Accepted by the facility",
  disputed: "Disputed",
  resolved_on_site: "Resolved on site",
};

function ObservationsCard({ sessionId, packet, readOnly }: {
  sessionId: string; packet: SurveyDayPacket; readOnly: boolean;
}) {
  const { toast } = useToast();
  const record = useRecordSurveyDayObservation();
  const [entryType, setEntryType] = useState<SurveyDayEntryType>("observation");
  const [summary, setSummary] = useState("");
  const [subjectRole, setSubjectRole] = useState("");
  const [citation, setCitation] = useState("");
  const [disposition, setDisposition] = useState<SurveyDayFindingDisposition>("potential");
  const [basis, setBasis] = useState("");

  const isFinding = entryType === "potential_finding";
  // Mirrors the table's own constraint: a finding recorded as disputed with no basis written down is
  // worse than one recorded plainly, because it reads as a denial with nothing behind it.
  const basisRequired = isFinding && disposition === "disputed";
  const canSubmit = summary.trim().length >= 3 && (!basisRequired || basis.trim().length > 0);

  const submit = () => record.mutate(
    {
      sessionId,
      entryType,
      summary: summary.trim(),
      subjectRole: subjectRole.trim() || undefined,
      citation: isFinding ? citation.trim() || undefined : undefined,
      findingDisposition: isFinding ? disposition : undefined,
      findingBasis: isFinding ? basis.trim() || undefined : undefined,
    },
    {
      onSuccess: () => { setSummary(""); setSubjectRole(""); setCitation(""); setBasis(""); },
      onError: (e: Error) => toast({ title: "Could not record the entry", description: e.message, variant: "destructive" }),
    },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5" />What was seen and said</CardTitle>
        <CardDescription>
          Interviews, observations, and anything the surveyor flagged. Record roles rather than names
          where a name is not needed — this log is not a clinical record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <EntryList title="Interviews" entries={packet.interviews} />
        <EntryList title="Observations" entries={packet.observations} />

        <div>
          <p className="mb-2 text-sm font-medium">Potential findings</p>
          {packet.potentialFindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing flagged so far.</p>
          ) : (
            <ul className="space-y-2">
              {packet.potentialFindings.map((finding) => (
                <li key={finding.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm">{finding.summary}</p>
                    <div className="flex gap-2">
                      {finding.citation && <Badge variant="outline">{finding.citation}</Badge>}
                      {finding.disposition && <Badge variant="secondary">{DISPOSITION_LABEL[finding.disposition]}</Badge>}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{displayTime(finding.occurredAt)}</p>
                  {finding.basis && <p className="mt-1 text-xs">Facility position: {finding.basis}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!readOnly && (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="entry-type">Entry</Label>
                <Select value={entryType} onValueChange={(v) => setEntryType(v as SurveyDayEntryType)}>
                  <SelectTrigger id="entry-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="observation">Observation</SelectItem>
                    <SelectItem value="interview">Interview</SelectItem>
                    <SelectItem value="potential_finding">Potential finding</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="entry-subject">Subject role</Label>
                <Input
                  id="entry-subject"
                  value={subjectRole}
                  onChange={(e) => setSubjectRole(e.target.value)}
                  placeholder="Direct care staff, administrator, …"
                />
              </div>
            </div>
            <Textarea
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What happened, in plain words"
            />
            {isFinding && (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="finding-citation">Citation</Label>
                    <Input
                      id="finding-citation"
                      value={citation}
                      onChange={(e) => setCitation(e.target.value)}
                      placeholder="The regulation the surveyor cited"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="finding-disposition">Facility position</Label>
                    <Select value={disposition} onValueChange={(v) => setDisposition(v as SurveyDayFindingDisposition)}>
                      <SelectTrigger id="finding-disposition"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="potential">Potential — not decided yet</SelectItem>
                        <SelectItem value="accepted">Accepted</SelectItem>
                        <SelectItem value="disputed">Disputed</SelectItem>
                        <SelectItem value="resolved_on_site">Resolved on site</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Textarea
                  rows={2}
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                  placeholder={basisRequired
                    ? "Why the facility disputes this — required"
                    : "The facility's position, if there is one"}
                />
              </div>
            )}
            <Button disabled={!canSubmit || record.isPending} onClick={submit}>
              {record.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record entry
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EntryList({ title, entries }: {
  title: string;
  entries: { id: string; occurredAt: string; summary: string; subjectRole: string | null }[];
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-md border p-3">
              <p className="text-sm">{entry.summary}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {displayTime(entry.occurredAt)}
                {entry.subjectRole ? ` · ${entry.subjectRole}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PacketCard({ sessionId, packet, readOnly }: {
  sessionId: string; packet: SurveyDayPacket; readOnly: boolean;
}) {
  const { toast } = useToast();
  const assembled = useRecordSurveyDayPacketAssembled();
  const unresolved = packet.openRequests;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileCheck2 className="h-5 w-5" />Evidence packet</CardTitle>
        <CardDescription>
          Everything above, read fresh each time. The packet is not a stored copy — a frozen snapshot
          would become a second version of the truth that drifts from the record it summarises.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <PacketStat label="Surveyors" value={packet.surveyors.length} />
          <PacketStat label="Requests" value={packet.requests.length} />
          <PacketStat label="Interviews and observations" value={packet.interviews.length + packet.observations.length} />
          <PacketStat label="Potential findings" value={packet.potentialFindings.length} />
        </div>

        {unresolved > 0 && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
            <p className="text-sm">
              {unresolved} request{unresolved === 1 ? " is" : "s are"} still open. A packet assembled now
              records that state rather than hiding it.
            </p>
          </div>
        )}

        {!readOnly && (
          <Button
            variant="outline"
            disabled={assembled.isPending}
            onClick={() => assembled.mutate({ sessionId }, {
              onSuccess: () => toast({ title: "Packet assembly recorded", description: "The session log now shows who assembled it and when." }),
              onError: (e: Error) => toast({ title: "Could not record it", description: e.message, variant: "destructive" }),
            })}
          >
            {assembled.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record packet assembled
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function PacketStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
