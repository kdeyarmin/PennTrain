import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  useGetConfidentialIntake,
  useListIntakeAccessEvents,
  useOpenIntakeDetails,
  useRevealReporterIdentity,
  useSetIntakeStatus,
  type ConfidentialIntakeDetails,
  type RevealedReporterIdentity,
} from "@/hooks/useConfidentialIncidents";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import { IntakePill } from "@/pages/app/ConfidentialIncidents";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { formatDateForDisplay } from "@/lib/dateUtils";
import {
  AlertTriangle, ArrowLeft, FileLock2, History, Loader2, ShieldAlert, UserRoundSearch,
} from "lucide-react";

const SEVERITY_VARIANT: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  moderate: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  high: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  critical: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};
const STATUS_VARIANT: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  triage: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  investigating: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  review: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  closed: "bg-muted text-muted-foreground",
  retained: "bg-muted text-muted-foreground",
};

// Mirrors the transition guard in set_confidential_intake_status: forward review states
// from any open state, retention hold only from closed, retained is terminal.
function nextStatuses(current: string): string[] {
  if (current === "closed") return ["retained"];
  if (current === "retained") return [];
  return ["triage", "investigating", "review", "closed"].filter(s => s !== current);
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  view_summary: "Viewed summary",
  view_details: "Viewed protected details",
  view_identity: "Viewed reporter identity",
  download: "Downloaded",
  disclose: "Disclosed",
  status_change: "Changed status",
  denied: "Access denied",
};

export default function ConfidentialIncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: intake, isLoading, isError, error, refetch } = useGetConfidentialIntake(id);
  const { data: facilities } = useListFacilities({});
  const { data: accessEvents, isError: eventsError } = useListIntakeAccessEvents(id);
  const { data: profiles } = useListProfiles();
  const { mutate: openDetails, isPending: openingDetails } = useOpenIntakeDetails();
  const { mutate: setStatus, isPending: settingStatus } = useSetIntakeStatus();
  const { mutate: revealIdentity, isPending: revealing } = useRevealReporterIdentity();

  const [details, setDetails] = useState<ConfidentialIntakeDetails | null>(null);
  const [detailsPurpose, setDetailsPurpose] = useState("");
  const [statusTarget, setStatusTarget] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [identityPurpose, setIdentityPurpose] = useState("");
  const [identity, setIdentity] = useState<RevealedReporterIdentity | null>(null);

  const facilityName = useMemo(
    () => new Map((facilities ?? []).map(f => [f.id, f.name])).get(intake?.facility_id ?? "") ?? "—",
    [facilities, intake?.facility_id],
  );
  const profileNameById = useMemo(
    () => new Map((profiles ?? []).map(p => [p.id, `${p.first_name} ${p.last_name}`])),
    [profiles],
  );

  const canReviewDetails = ["platform_admin", "org_admin", "auditor"].includes(user?.role ?? "");
  const canAct = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  const handleOpenDetails = () => {
    if (!id) return;
    openDetails(
      { intakeId: id, purpose: detailsPurpose.trim() },
      {
        onSuccess: (row) => {
          setDetails(row);
          if (!row) toast({ title: "No protected details on file for this intake" });
        },
        onError: (e: Error) =>
          toast({ title: "Couldn't open protected details", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleSetStatus = () => {
    if (!id || !statusTarget) return;
    setStatus(
      { intakeId: id, targetStatus: statusTarget, reason: statusReason.trim() },
      {
        onSuccess: () => {
          toast({ title: `Status changed to ${statusTarget}` });
          setStatusTarget("");
          setStatusReason("");
        },
        onError: (e: Error) =>
          toast({ title: "Couldn't change status", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleReveal = () => {
    if (!id) return;
    revealIdentity(
      { intakeId: id, purpose: identityPurpose.trim() },
      {
        onSuccess: (result) => setIdentity(result),
        onError: (e: Error) =>
          toast({ title: "Couldn't reveal reporter identity", description: e.message, variant: "destructive" }),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (isError || !intake) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/confidential-incidents"><ArrowLeft className="h-4 w-4 mr-1" /> Confidential Reports</Link>
        </Button>
        <QueryError what="this confidential report" error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const allowedTargets = nextStatuses(intake.status);

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/app/confidential-incidents"><ArrowLeft className="h-4 w-4 mr-1" /> Confidential Reports</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight font-mono">{intake.intake_number}</h1>
          <IntakePill value={intake.status} map={STATUS_VARIANT} />
          <IntakePill value={intake.severity} map={SEVERITY_VARIANT} />
        </div>
        <p className="text-muted-foreground mt-1">
          {facilityName} · Reported {formatDateForDisplay(intake.reported_at)}
          {intake.occurred_at && <> · Occurred {formatDateForDisplay(intake.occurred_at)}</>}
          {" · "}{intake.reporter_mode === "anonymous" ? "Anonymous reporter" : "Identified reporter"}
        </p>
      </div>

      {intake.immediate_danger && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Immediate danger was reported</AlertTitle>
          <AlertDescription>
            The reporter indicated someone may be in immediate danger. Urgent triage work was
            routed automatically when this report was submitted.
            {intake.triage_work_item_id && (
              <Button asChild variant="outline" size="sm" className="ml-3">
                <Link href={`/app/work/${intake.triage_work_item_id}`}>Open triage work</Link>
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>The broadly-visible triage summary provided by the reporter.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{intake.public_summary}</p>
        </CardContent>
      </Card>

      {canReviewDetails && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileLock2 className="h-5 w-5" /> Protected details</CardTitle>
            <CardDescription>
              The full narrative is restricted. Opening it records a permanent access event with
              your name and the purpose you give here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {details ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Narrative</p>
                  <p className="whitespace-pre-wrap">{details.narrative}</p>
                </div>
                {details.location_detail && (
                  <div>
                    <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Location</p>
                    <p>{details.location_detail}</p>
                  </div>
                )}
                {details.investigation_findings && (
                  <div>
                    <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Investigation findings</p>
                    <p className="whitespace-pre-wrap">{details.investigation_findings}</p>
                  </div>
                )}
                {details.root_cause && (
                  <div>
                    <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Root cause</p>
                    <p className="whitespace-pre-wrap">{details.root_cause}</p>
                  </div>
                )}
                {details.regulatory_deadline_at && (
                  <div>
                    <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Regulatory deadline</p>
                    <p>{formatDateForDisplay(details.regulatory_deadline_at)}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5 grow max-w-md">
                  <Label className="text-[13px]">Purpose of review *</Label>
                  <Input
                    value={detailsPurpose}
                    onChange={e => setDetailsPurpose(e.target.value)}
                    placeholder="e.g. Triaging newly submitted report"
                    className="h-9"
                  />
                </div>
                <Button onClick={handleOpenDetails} disabled={openingDetails || detailsPurpose.trim().length < 5}>
                  {openingDetails ? "Opening..." : "Open protected details"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canAct && (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>
              Move this report through triage, investigation, review, and closure. Each change is
              recorded in the access ledger with your reason.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {allowedTargets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This report is under a retention hold and can no longer change state.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">New status</Label>
                  <Select value={statusTarget} onValueChange={setStatusTarget}>
                    <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Select status" /></SelectTrigger>
                    <SelectContent>
                      {allowedTargets.map(s => (
                        <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 grow max-w-md">
                  <Label className="text-[13px]">Reason *</Label>
                  <Input
                    value={statusReason}
                    onChange={e => setStatusReason(e.target.value)}
                    placeholder="e.g. Investigation assigned to administrator"
                    className="h-9"
                  />
                </div>
                <Button
                  onClick={handleSetStatus}
                  disabled={settingStatus || !statusTarget || statusReason.trim().length < 5}
                >
                  {settingStatus ? "Saving..." : "Change status"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canAct && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserRoundSearch className="h-5 w-5" /> Reporter identity</CardTitle>
            <CardDescription>
              Reporter identity is stored separately from this report and is the most sensitive
              record in this system. Revealing it requires a recent multi-factor sign-in and is
              permanently logged — including when the reporter turns out to be anonymous.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {identity ? (
              identity.identityOnFile ? (
                <div className="text-sm space-y-1">
                  <p><span className="font-medium">Reporter:</span> {identity.reporterName ?? "Name not on profile"}</p>
                  {identity.reporterEmail && <p><span className="font-medium">Email:</span> {identity.reporterEmail}</p>}
                  <p>
                    <span className="font-medium">Consent to contact:</span>{" "}
                    {identity.consentToContact ? "Yes" : "No"}
                  </p>
                  {identity.recordedAt && (
                    <p className="text-muted-foreground text-xs">Identity recorded {formatDateForDisplay(identity.recordedAt)}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This report was submitted anonymously — no reporter identity is on file. Your
                  reveal attempt has been recorded in the access ledger.
                </p>
              )
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5 grow max-w-md">
                  <Label className="text-[13px]">Purpose of reveal *</Label>
                  <Input
                    value={identityPurpose}
                    onChange={e => setIdentityPurpose(e.target.value)}
                    placeholder="e.g. Regulatory follow-up requires reporter contact"
                    className="h-9"
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={handleReveal}
                  disabled={revealing || identityPurpose.trim().length < 5}
                >
                  <ShieldAlert className="h-4 w-4 mr-1.5" />
                  {revealing ? "Revealing..." : "Reveal reporter identity"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canReviewDetails && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Access ledger</CardTitle>
            <CardDescription>Append-only record of every view, reveal, and status change on this report.</CardDescription>
          </CardHeader>
          <CardContent>
            {eventsError ? (
              <p className="text-sm text-muted-foreground">The access ledger could not be loaded.</p>
            ) : !accessEvents?.length ? (
              <p className="text-sm text-muted-foreground text-center py-4">No access events recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {accessEvents.map(e => (
                  <div key={e.id} className="flex items-start justify-between gap-3 py-2 border-b last:border-0 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}
                        <span className="text-muted-foreground font-normal">
                          {" "}· {e.actor_profile_id ? profileNameById.get(e.actor_profile_id) ?? "Unknown user" : "System"}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{e.purpose}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(e.occurred_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
