import { useMemo, useState } from "react";
import { Award, CheckCircle2, CircleDashed, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import {
  useApproveCertificationAttempt, useAvailableCertificationVersions, useCertificationChecklist,
  useEmployeeCertificationAttempts, useRecordCertificationAttemptItem,
  useStartCertificationAttempt, useSubmitCertificationAttempt,
} from "@/hooks/useCertificationAttempts";
import {
  attemptIsOpen, attemptStatusLabel, decisionIssue, outstandingChecklistItems, signatureDigest,
  type AttemptResult,
} from "@/lib/certificationAttempt";

/**
 * Observing a competency, recording it, and deciding it (BACKLOG.md G8).
 *
 * The capability was built in full in 20260711213000 and had no entry point: nothing created an
 * attempt or recorded a checklist item, so `approve_certification_attempt` -- which re-checks
 * assessor qualification at observation time, separation of duties, checklist effectivity, and
 * per-item evidence and signatures -- approved rows that could not exist.
 *
 * Ordered by what the assessor is doing: start the observation, work down the checklist at the
 * bedside, then decide. The outstanding list is always visible rather than revealed on submit,
 * because the server refuses an incomplete attempt and finding that out afterwards means the
 * observation has already ended.
 */
export default function CertificationAttemptSection({
  employeeId, employeeName,
}: {
  employeeId: string;
  employeeName: string;
}) {
  const { toast } = useToast();
  const versions = useAvailableCertificationVersions();
  const attempts = useEmployeeCertificationAttempts(employeeId);
  const start = useStartCertificationAttempt(employeeId);
  const record = useRecordCertificationAttemptItem(employeeId);
  const submit = useSubmitCertificationAttempt(employeeId);
  const approve = useApproveCertificationAttempt(employeeId);

  const [versionId, setVersionId] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [typedName, setTypedName] = useState("");
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, string>>({});

  // The one attempt an assessor can act on. More than one open attempt per checklist version is
  // refused by the server, so "the open one" is well-defined.
  const openAttempt = useMemo(
    () => (attempts.data ?? []).find((attempt) => attemptIsOpen(attempt.status)) ?? null,
    [attempts.data],
  );
  const checklist = useCertificationChecklist(
    openAttempt?.certification_version_id, openAttempt?.id,
  );
  const outstanding = useMemo(
    () => outstandingChecklistItems(checklist.data ?? []),
    [checklist.data],
  );

  const startAttempt = async () => {
    try {
      await start.mutateAsync({ certificationVersionId: versionId });
      toast({ title: "Observation started" });
      setVersionId("");
    } catch (error) {
      toast({
        title: "Could not start the observation",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const recordItem = async (
    checklistItemId: string, result: AttemptResult, evidenceRequired: boolean, signatureRequired: boolean,
  ) => {
    if (!openAttempt) return;
    const note = (evidenceDrafts[checklistItemId] ?? "").trim();
    try {
      await record.mutateAsync({
        attemptId: openAttempt.id,
        checklistItemId,
        result,
        // The server stores evidence as jsonb and refuses `{}` where evidence is required; what the
        // assessor typed is the evidence, so it goes in under a named key rather than as a bare
        // string the next reader has to guess the meaning of.
        evidence: evidenceRequired && note ? { observed: note } : {},
        sign: signatureRequired && result !== "not_applicable",
        notes: note || undefined,
      });
    } catch (error) {
      toast({
        title: "Could not record that item",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const submitAttempt = async () => {
    if (!openAttempt) return;
    try {
      await submit.mutateAsync(openAttempt.id);
      toast({ title: "Observation submitted", description: "It is now awaiting a decision." });
    } catch (error) {
      toast({
        title: "Could not submit the observation",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const decide = async (decision: "passed" | "failed") => {
    if (!openAttempt) return;
    try {
      const signature = await signatureDigest(
        `${typedName.trim()}|${openAttempt.id}|${decision}|${decisionReason.trim()}`,
      );
      await approve.mutateAsync({
        attemptId: openAttempt.id, decision, reason: decisionReason.trim(), signatureSha256: signature,
      });
      toast({
        title: decision === "passed" ? "Certification passed" : "Certification failed",
        description: decision === "passed"
          ? "The qualification is now active for this employee."
          : "The decision and its reason are on the record.",
      });
      setDecisionReason("");
      setTypedName("");
    } catch (error) {
      toast({
        title: "Could not record the decision",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const issue = decisionIssue({ reason: decisionReason, typedName });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5" /> Competency observations
        </CardTitle>
        <CardDescription>
          Observed skills certification for {employeeName}. The decision re-checks that you were a
          qualified assessor at the time you observed, so start the attempt when the observation
          actually begins.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {attempts.isError ? (
          <QueryError what="certification attempts" error={attempts.error} onRetry={() => void attempts.refetch()} />
        ) : attempts.isLoading ? (
          <Skeleton className="h-20" />
        ) : !openAttempt ? (
          <div className="space-y-2">
            <Label htmlFor="certification-version">Start an observation</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={versionId} onValueChange={setVersionId} disabled={versions.isLoading || versions.isError}>
                <SelectTrigger id="certification-version" className="sm:w-96">
                  <SelectValue placeholder="Select a published checklist" />
                </SelectTrigger>
                <SelectContent>
                  {(versions.data ?? []).map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {version.certification_definitions?.name ?? "Certification"} · v{version.version_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button disabled={!versionId || start.isPending || versions.isError || versions.isLoading} onClick={() => void startAttempt()}>
                {start.isPending ? "Starting…" : "Start observation"}
              </Button>
            </div>
            {versions.isError ? (
              <QueryError what="published checklists" error={versions.error} onRetry={() => void versions.refetch()} />
            ) : (versions.data ?? []).length === 0 && !versions.isLoading ? (
              <p className="text-xs text-muted-foreground">
                No published checklist is currently effective, so there is nothing to observe against.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">
                {openAttempt.certification_definition_versions?.certification_definitions?.name ?? "Certification"}
              </p>
              <Badge variant="outline">{attemptStatusLabel(openAttempt.status)}</Badge>
              <span className="text-xs text-muted-foreground">
                observed {new Date(openAttempt.observed_at).toLocaleString()}
              </span>
            </div>

            {checklist.isLoading ? <Skeleton className="h-24" /> : checklist.isError ? (
              <QueryError what="certification checklist" error={checklist.error} onRetry={() => void checklist.refetch()} />
            ) : (
              <ul className="space-y-2">
                {(checklist.data ?? []).map(({ item, recorded }) => (
                  <li key={item.id} className="rounded-md border p-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="flex items-start gap-2 text-sm">
                        {recorded
                          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span>
                          {item.prompt}
                          {(item.evidence_required || item.signature_required) && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({[item.evidence_required && "evidence", item.signature_required && "signature"]
                                .filter(Boolean).join(" + ")} required)
                            </span>
                          )}
                          {recorded && (
                            <span className="ml-1 text-xs text-muted-foreground">· {recorded.result.replace(/_/gu, " ")}</span>
                          )}
                        </span>
                      </span>
                      {openAttempt.status === "in_progress" && (
                        <div className="flex flex-wrap gap-1">
                          {(["met", "not_met", "not_applicable"] as AttemptResult[]).map((result) => (
                            <Button
                              key={result} size="sm"
                              variant={recorded?.result === result ? "default" : "outline"}
                              disabled={record.isPending}
                              onClick={() => void recordItem(item.id, result, item.evidence_required, item.signature_required)}
                            >
                              {result === "not_applicable" ? "N/A" : result.replace(/_/gu, " ")}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                    {openAttempt.status === "in_progress" && item.evidence_required && (
                      <Input
                        className="mt-2"
                        aria-label={`Evidence for ${item.prompt}`}
                        placeholder="What you observed — required before this item counts as complete"
                        value={evidenceDrafts[item.id] ?? ""}
                        onChange={(event) => setEvidenceDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {!checklist.isError && outstanding.length > 0 && (
              <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                <p className="font-medium">Outstanding before this can be decided</p>
                <ul className="mt-1 space-y-0.5">
                  {outstanding.map((entry) => (
                    <li key={entry.itemKey}>{entry.prompt} — {entry.missing}</li>
                  ))}
                </ul>
              </div>
            )}

            {openAttempt.status === "in_progress" && (
              <Button
                variant="outline" size="sm"
                disabled={checklist.isError || checklist.isLoading || outstanding.length > 0 || submit.isPending}
                title={
                  checklist.isError || checklist.isLoading
                    ? "Load the checklist before submitting."
                    : outstanding.length > 0
                      ? "Complete every checklist item first."
                      : undefined
                }
                onClick={() => void submitAttempt()}
              >
                {submit.isPending ? "Submitting…" : "Submit observation"}
              </Button>
            )}

            <div className="space-y-2 border-t pt-4">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <ShieldCheck className="h-4 w-4" /> Decision
              </p>
              <p className="text-xs text-muted-foreground">
                A pass grants the qualification immediately. The server independently re-checks that
                you were qualified to assess this at the observed time and that every required item
                carries its evidence and signature.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="decision-reason">Reason</Label>
                <Textarea
                  id="decision-reason" rows={2} value={decisionReason}
                  onChange={(event) => setDecisionReason(event.target.value)}
                  placeholder="Observed a full medication pass without prompting."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="decision-signature">Sign by typing your name</Label>
                <Input
                  id="decision-signature" value={typedName}
                  onChange={(event) => setTypedName(event.target.value)}
                />
              </div>
              {issue && <p className="text-xs text-muted-foreground">{issue}</p>}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={Boolean(issue) || checklist.isError || checklist.isLoading || outstanding.length > 0 || approve.isPending}
                  title={
                    checklist.isError || checklist.isLoading
                      ? "Load the checklist before deciding."
                      : outstanding.length > 0
                        ? "Complete every checklist item first."
                        : undefined
                  }
                  onClick={() => void decide("passed")}
                >
                  Pass
                </Button>
                <Button
                  size="sm" variant="outline"
                  disabled={Boolean(issue) || checklist.isError || checklist.isLoading || outstanding.length > 0 || approve.isPending}
                  onClick={() => void decide("failed")}
                >
                  Fail
                </Button>
              </div>
            </div>
          </div>
        )}

        {(attempts.data ?? []).filter((attempt) => !attemptIsOpen(attempt.status)).length > 0 && (
          <div className="space-y-1 border-t pt-4">
            <p className="text-sm font-medium">Decided observations</p>
            {(attempts.data ?? []).filter((attempt) => !attemptIsOpen(attempt.status)).map((attempt) => (
              <p key={attempt.id} className="text-xs text-muted-foreground">
                {attempt.certification_definition_versions?.certification_definitions?.name ?? "Certification"}
                {" · "}{attemptStatusLabel(attempt.status)}
                {attempt.decided_at ? ` · ${new Date(attempt.decided_at).toLocaleDateString()}` : ""}
                {attempt.decision_reason ? ` — ${attempt.decision_reason}` : ""}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
