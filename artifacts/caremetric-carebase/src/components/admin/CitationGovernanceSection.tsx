import { useEffect, useMemo, useState } from "react";
import { BookCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import {
  useCitationGovernanceStatus, useCitationTopics, useRecordCitationSuperseded,
  useRecordCitationVerification, type CitationTopic,
} from "@/hooks/useCitationGovernance";
import {
  citationDisplay, CITATION_REVERIFICATION_INTERVAL_DAYS, supersessionFormIssues,
  verificationFormIssues,
} from "@/lib/citationGovernance";

/**
 * Citation verification governance (Phase 10b).
 *
 * Phase 10b built the mechanism -- a status that cannot be claimed without a named person, a date
 * and a source URL -- and wired the *display* half so the readiness table shows "(2600.65 —
 * approximate)". The write half had no surface. Every citation in the product sat at `unverified` or
 * `approximate` with no path out, which meant the qualifier was permanent regardless of what anyone
 * checked.
 *
 * This is the way in. It deliberately does not seed content: the plan names a confidently-wrong
 * citation in a survey packet as this product's worst failure mode, so the values come from a person
 * with the regulation open, one row at a time, each with the URL they read.
 */

const STATUS_STYLE: Record<string, string> = {
  verified: "border-emerald-600 text-emerald-700 dark:text-emerald-500",
  approximate: "border-amber-500 text-amber-700 dark:text-amber-500",
  unverified: "border-amber-500 text-amber-700 dark:text-amber-500",
  superseded: "border-muted-foreground/40 text-muted-foreground",
};

function todayForInput(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function VerifyDialog({
  topic, onOpenChange,
}: {
  topic: CitationTopic | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const record = useRecordCitationVerification();
  const [citationRef, setCitationRef] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [verifiedOn, setVerifiedOn] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  useEffect(() => {
    if (!topic) return;
    // Pre-filled with what is on record so a verification that confirms the existing number is one
    // field of typing, not four -- but it stays editable, because confirming a wrong number is the
    // failure this whole mechanism exists to prevent.
    setCitationRef(topic.citation_ref ?? "");
    setSourceUrl(topic.source_url ?? "");
    setVerifiedOn(todayForInput());
    setEffectiveDate(topic.effective_date ?? "");
  }, [topic]);

  const issues = verificationFormIssues({ citationRef, sourceUrl, verifiedOn });

  const submit = async () => {
    if (!topic) return;
    try {
      await record.mutateAsync({
        topicId: topic.id,
        citationRef: citationRef.trim(),
        sourceUrl: sourceUrl.trim(),
        effectiveDate: effectiveDate || undefined,
        verifiedOn: verifiedOn || undefined,
      });
      toast({ title: "Citation verified", description: "Your name and the date are on the record." });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not record the verification",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={Boolean(topic)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Verify citation</DialogTitle>
          <DialogDescription>
            {topic?.title ?? ""} — record the section number as it appears in the regulation you have
            open, and the URL you read it at. Verification expires after{" "}
            {CITATION_REVERIFICATION_INTERVAL_DAYS} days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="verify-ref">Section number</Label>
            <Input id="verify-ref" value={citationRef} onChange={(e) => setCitationRef(e.target.value)} placeholder="2600.65" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="verify-source">Source URL</Label>
            <Input id="verify-source" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://www.pacodeandbulletin.gov/..." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="verify-on">Verified on</Label>
              <Input id="verify-on" type="date" value={verifiedOn} onChange={(e) => setVerifiedOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verify-effective">Effective date (optional)</Label>
              <Input id="verify-effective" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </div>
          </div>
          {issues.length > 0 && (
            <ul className="space-y-1 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              {issues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={issues.length > 0 || record.isPending}>
            {record.isPending ? "Recording…" : "Record verification"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SupersedeDialog({
  topic, onOpenChange,
}: {
  topic: CitationTopic | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const record = useRecordCitationSuperseded();
  const [supersededByRef, setSupersededByRef] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  useEffect(() => {
    if (!topic) return;
    setSupersededByRef("");
    setSourceUrl(topic.source_url ?? "");
  }, [topic]);

  const issues = supersessionFormIssues({ supersededByRef });

  const submit = async () => {
    if (!topic) return;
    try {
      await record.mutateAsync({
        topicId: topic.id,
        supersededByRef: supersededByRef.trim(),
        sourceUrl: sourceUrl.trim() || undefined,
      });
      toast({ title: "Citation marked superseded" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not record the supersession",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={Boolean(topic)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark citation superseded</DialogTitle>
          <DialogDescription>
            {topic?.title ?? ""} — the readiness table will show this reference with its successor
            attached, so nobody quotes the retired number.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="supersede-ref">Replaced by</Label>
            <Input id="supersede-ref" value={supersededByRef} onChange={(e) => setSupersededByRef(e.target.value)} placeholder="2600.66" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supersede-source">Source URL (optional)</Label>
            <Input id="supersede-source" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </div>
          {issues.length > 0 && (
            <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">{issues[0]}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={issues.length > 0 || record.isPending}>
            {record.isPending ? "Recording…" : "Mark superseded"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CitationGovernanceSection() {
  const topicsQuery = useCitationTopics();
  const statusQuery = useCitationGovernanceStatus();
  const [verifying, setVerifying] = useState<CitationTopic | null>(null);
  const [superseding, setSuperseding] = useState<CitationTopic | null>(null);

  const status = statusQuery.data;
  const counts = useMemo(() => {
    const byStatus = status?.byStatus ?? {};
    return [
      { key: "verified", label: "Verified", value: byStatus.verified ?? 0 },
      { key: "approximate", label: "Approximate", value: byStatus.approximate ?? 0 },
      { key: "unverified", label: "Unverified", value: byStatus.unverified ?? 0 },
      { key: "superseded", label: "Superseded", value: byStatus.superseded ?? 0 },
    ];
  }, [status]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookCheck className="h-5 w-5" /> Citation verification
          </CardTitle>
          <CardDescription>
            Every citation the product shows an operator carries a qualifier until somebody records
            checking it against the regulation. Verification needs a section number, the URL you read
            it at, and a date — and expires after {CITATION_REVERIFICATION_INTERVAL_DAYS} days,
            because a citation checked once and never re-checked is how a retired section number
            survives in a product for years.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {statusQuery.isError ? (
            <QueryError
              what="citation governance status"
              error={statusQuery.error}
              onRetry={() => void statusQuery.refetch()}
            />
          ) : statusQuery.isLoading ? (
            <Skeleton className="h-16" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {counts.map((entry) => (
                  <div key={entry.key} className="rounded-md border p-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{entry.label}</p>
                    <p className="text-xl font-semibold">{entry.value}</p>
                  </div>
                ))}
              </div>
              {(status?.staleVerified ?? 0) > 0 && (
                <p className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-2 text-sm">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    {status?.staleVerified} verified citation(s) are past their re-verification
                    interval and have stopped counting as citable.
                  </span>
                </p>
              )}
            </>
          )}

          {topicsQuery.isError ? (
            <QueryError
              what="citation topics"
              error={topicsQuery.error}
              onRetry={() => void topicsQuery.refetch()}
            />
          ) : topicsQuery.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Topic</TableHead>
                    <TableHead>Citation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(topicsQuery.data ?? []).map((topic) => {
                    const display = citationDisplay(topic);
                    return (
                      <TableRow key={topic.id}>
                        <TableCell>
                          <span className="font-medium">{topic.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {topic.chapter}{topic.category ? ` · ${topic.category}` : ""}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{display.text ?? "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${STATUS_STYLE[topic.verification_status] ?? STATUS_STYLE.unverified}`}
                          >
                            {display.qualifier ?? "verified"}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {topic.verified_on ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setVerifying(topic)}>
                              {topic.verification_status === "verified" ? "Re-verify" : "Verify"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setSuperseding(topic)}>
                              Superseded
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <VerifyDialog topic={verifying} onOpenChange={(open) => { if (!open) setVerifying(null); }} />
      <SupersedeDialog topic={superseding} onOpenChange={(open) => { if (!open) setSuperseding(null); }} />
    </>
  );
}
