import { useMemo, useState } from "react";
import { CheckCircle2, FileScan, RefreshCw, XCircle } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListEmployeesByIds } from "@/hooks/useEmployees";
import {
  extractedFieldString,
  renewalSlaLabel,
  useCredentialRenewalQueueSummary,
  useCredentialRenewalSubmissions,
  useReviewCredentialRenewal,
  type CredentialRenewalSubmission,
} from "@/hooks/useCredentialRenewals";

const STATUSES = [
  "uploaded",
  "scanning",
  "quarantined",
  "extracted",
  "needs_review",
  "approved",
  "rejected",
] as const;

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "rejected" || status === "quarantined") return "destructive";
  if (status === "needs_review") return "secondary";
  return "outline";
}

export function CredentialRenewalInbox({
  metrics,
}: {
  metrics?: Record<string, unknown>;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState("needs_review");
  const submissions = useCredentialRenewalSubmissions({ status, pageSize: 50 });
  const queue = useCredentialRenewalQueueSummary();
  const review = useReviewCredentialRenewal();
  const [selected, setSelected] = useState<CredentialRenewalSubmission | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [reason, setReason] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [credentialNumber, setCredentialNumber] = useState("");
  const [credentialLabel, setCredentialLabel] = useState("");

  const employeeIds = useMemo(
    () => [...new Set((submissions.data?.rows ?? []).map((row) => row.employee_id))],
    [submissions.data?.rows],
  );
  const employees = useListEmployeesByIds(employeeIds);
  const employeeName = (id: string) => {
    const employee = employees.data?.find((row) => row.id === id);
    return employee ? `${employee.first_name} ${employee.last_name}` : id.slice(0, 8);
  };

  const openReview = (row: CredentialRenewalSubmission, nextDecision: "approve" | "reject") => {
    setSelected(row);
    setDecision(nextDecision);
    setReason("");
    setIssuingAuthority(extractedFieldString(row.extracted_fields, "issuingAuthority")
      || extractedFieldString(row.extracted_fields, "issuer"));
    setExpirationDate(extractedFieldString(row.extracted_fields, "expirationDate")
      || extractedFieldString(row.extracted_fields, "expiration_date"));
    setIssueDate(extractedFieldString(row.extracted_fields, "issueDate")
      || extractedFieldString(row.extracted_fields, "issue_date"));
    setCredentialNumber(extractedFieldString(row.extracted_fields, "credentialNumber")
      || extractedFieldString(row.extracted_fields, "credential_number"));
    setCredentialLabel(extractedFieldString(row.extracted_fields, "credentialLabel")
      || extractedFieldString(row.extracted_fields, "label"));
  };

  const submitReview = async () => {
    if (!selected || reason.trim().length < 5) return;
    if (user?.id && selected.submitted_by && user.id === selected.submitted_by) {
      toast({
        title: "Independent reviewer required",
        description: "The person who submitted this renewal cannot approve or reject it.",
        variant: "destructive",
      });
      return;
    }
    try {
      await review.mutateAsync({
        submissionId: selected.id,
        decision,
        reason: reason.trim(),
        confirmedFields: decision === "approve"
          ? {
              issuingAuthority: issuingAuthority.trim(),
              expirationDate: expirationDate.trim(),
              issueDate: issueDate.trim() || undefined,
              credentialNumber: credentialNumber.trim() || undefined,
              credentialLabel: credentialLabel.trim() || undefined,
            }
          : {},
      });
      toast({
        title: decision === "approve" ? "Renewal approved" : "Renewal rejected",
        description: "The governed decision was recorded and compliance was updated only on approval.",
      });
      setSelected(null);
    } catch (error) {
      toast({
        title: "Review blocked",
        description: error instanceof Error ? error.message : "Unable to record the decision",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      {metrics && Object.keys(metrics).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.entries(metrics).map(([key, value]) => (
            <Card key={key}>
              <CardHeader className="pb-2">
                <CardDescription>{key.replace(/([a-z])([A-Z])/g, "$1 $2")}</CardDescription>
                <CardTitle className="text-2xl">{typeof value === "number" ? value : String(value ?? "—")}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {queue.data && (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Needs review</p>
            <p className="text-2xl font-semibold">{queue.data.needsReview}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">In OCR pipeline</p>
            <p className="text-2xl font-semibold">{queue.data.uploaded}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Over 24h</p>
            <p className={`text-2xl font-semibold ${queue.data.overdue24h ? "text-amber-700" : ""}`}>
              {queue.data.overdue24h}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Over 72h</p>
            <p className={`text-2xl font-semibold ${queue.data.overdue72h ? "text-destructive" : ""}`}>
              {queue.data.overdue72h}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileScan className="h-5 w-5" /> Credential renewal inbox
            </CardTitle>
            <CardDescription>
              OCR and extraction are advisory. Compliance updates only when an independent reviewer confirms issuer and expiration.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44" aria-label="Credential renewal status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>{statusLabel(value)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => submissions.refetch()} disabled={submissions.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${submissions.isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {submissions.isLoading ? (
            <QueryLoading what="credential renewals" />
          ) : submissions.isError ? (
            <QueryError what="credential renewals" error={submissions.error} onRetry={() => submissions.refetch()} />
          ) : submissions.data?.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No renewal submissions in this state.
            </p>
          ) : (
            submissions.data?.rows.map((row) => {
              const isSelf = Boolean(user?.id && row.submitted_by && user.id === row.submitted_by);
              const canReview = row.status === "needs_review" && row.scan_status === "clean" && !isSelf;
              const sla = renewalSlaLabel(row.created_at);
              return (
                <div key={row.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{employeeName(row.employee_id)}</p>
                        <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                        <Badge
                          variant={sla.level === "critical" ? "destructive" : sla.level === "warn" ? "secondary" : "outline"}
                          title="Queue age"
                        >
                          {sla.label}
                        </Badge>
                        <Badge variant="outline">{row.credential_type.replaceAll("_", " ")}</Badge>
                        <Badge variant="outline">scan {row.scan_status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Submitted {new Date(row.created_at).toLocaleString()}
                        {row.reviewed_at ? ` · reviewed ${new Date(row.reviewed_at).toLocaleString()}` : ""}
                      </p>
                      {row.review_reason && (
                        <p className="text-xs text-muted-foreground">Review reason: {row.review_reason}</p>
                      )}
                      {isSelf && row.status === "needs_review" && (
                        <p className="text-xs text-amber-700">You submitted this package — another manager must review it.</p>
                      )}
                      <Button asChild size="sm" variant="link" className="h-auto px-0">
                        <Link href={`/app/employees/${row.employee_id}`}>Employee record</Link>
                      </Button>
                    </div>
                    {row.status === "needs_review" && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={!canReview || review.isPending} onClick={() => openReview(row, "approve")}>
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={!canReview || review.isPending}
                          onClick={() => openReview(row, "reject")}
                        >
                          <XCircle className="mr-2 h-4 w-4" /> Reject
                        </Button>
                      </div>
                    )}
                  </div>
                  {(row.extracted_fields && typeof row.extracted_fields === "object") && (
                    <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">Extracted suggestions (advisory)</p>
                      <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(row.extracted_fields, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{decision === "approve" ? "Approve credential renewal" : "Reject credential renewal"}</DialogTitle>
            <DialogDescription>
              Independent human decision only. Extraction fields are suggestions and never write compliance by themselves.
            </DialogDescription>
          </DialogHeader>
          {decision === "approve" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="renewal-issuer">Issuing authority</Label>
                <Input id="renewal-issuer" value={issuingAuthority} onChange={(event) => setIssuingAuthority(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="renewal-expiration">Expiration date</Label>
                <Input id="renewal-expiration" type="date" value={expirationDate} onChange={(event) => setExpirationDate(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="renewal-issue">Issue date</Label>
                <Input id="renewal-issue" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="renewal-number">Credential number</Label>
                <Input id="renewal-number" value={credentialNumber} onChange={(event) => setCredentialNumber(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="renewal-label">Label</Label>
                <Input id="renewal-label" value={credentialLabel} onChange={(event) => setCredentialLabel(event.target.value)} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="renewal-reason">Decision reason</Label>
            <Textarea
              id="renewal-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Documentation-backed reason for this independent decision"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button
              variant={decision === "approve" ? "default" : "destructive"}
              disabled={
                reason.trim().length < 5
                || review.isPending
                || (decision === "approve" && (!issuingAuthority.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)))
              }
              onClick={() => void submitReview()}
            >
              {decision === "approve" ? "Approve renewal" : "Reject renewal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
