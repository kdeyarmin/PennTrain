import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import {
  useListPolicyAttestations,
  useListPolicyAttestationCampaigns,
  useAttestPolicy,
  usePolicyKnowledgeCheck,
  type PolicyAttestation,
} from "@/hooks/usePolicyAttestations";
import { PolicyKnowledgeCheck } from "@/components/policies/PolicyKnowledgeCheck";
import { useListPolicyDocuments, useListPolicyDocumentVersionsForOrg, usePolicyDocumentSignedUrl } from "@/hooks/usePolicyDocuments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QueryError } from "@/components/QueryState";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FileCheck2, ExternalLink, Loader2 } from "lucide-react";
import { facilityDateOf, facilityDaysUntil, facilityToday, formatDateForDisplay, formatDueDistance } from "@/lib/dateUtils";

function fmtDate(iso: string | null): string {
  return formatDateForDisplay(iso, { dateStyle: "medium" });
}

function AttestationBadge({ attestation }: { attestation: PolicyAttestation }) {
  if (attestation.status === "attested") {
    return <Badge className="bg-success text-success-foreground hover:bg-success/80">Attested</Badge>;
  }
  // Before Overdue. Publishing a newer version stamps `superseded_at` on every still-pending
  // attestation against an older one, and attest-policy refuses to sign it afterwards. Showing it
  // as Overdue with a Review & Attest button asked this employee, every day for ever, to do the
  // one thing the server was going to reject.
  if (attestation.superseded_at) {
    return <Badge variant="outline">No longer required</Badge>;
  }
  if (attestation.due_date && attestation.due_date < facilityToday()) {
    return <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive/80">Overdue</Badge>;
  }
  return <Badge className="bg-warning text-warning-foreground hover:bg-warning/80">Pending</Badge>;
}

export default function MyAttestations() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  // Gate on a resolved employee id -- see useListPolicyAttestations' own comment on why `enabled`,
  // not just the filter, is required to avoid an unscoped fetch-then-refetch on every page load.
  const {
    data: attestations,
    isLoading: attestationsLoading,
    isError: attestationsError,
    error: attestationsErrorDetail,
    refetch: refetchAttestations,
  } = useListPolicyAttestations(
    { employeeId: employee?.id },
    { enabled: !!employee?.id },
  );
  const { data: campaigns } = useListPolicyAttestationCampaigns({ organizationId: user?.organizationId ?? undefined });
  const { data: documents } = useListPolicyDocuments({ organizationId: user?.organizationId ?? undefined });
  const { data: versions } = useListPolicyDocumentVersionsForOrg(user?.organizationId ?? undefined);
  const { mutateAsync: getSignedUrl } = usePolicyDocumentSignedUrl();
  const { mutateAsync: attestPolicy, isPending: attesting } = useAttestPolicy();

  // A superseded row is neither outstanding work nor a signature -- it sorts with the finished
  // ones so the top of this list is only what the employee can actually act on.
  const isActionable = (a: PolicyAttestation) => a.status === "pending" && !a.superseded_at;

  const [reviewing, setReviewing] = useState<PolicyAttestation | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [knowledgeCheckPassed, setKnowledgeCheckPassed] = useState(false);

  // Same query key as the PolicyKnowledgeCheck component below, so react-query serves both from one
  // fetch. Read here only to know *whether* a check applies -- the questions themselves are rendered
  // by that component.
  const {
    data: knowledgeCheckQuestions,
    isLoading: knowledgeCheckLoading,
    isError: knowledgeCheckError,
  } = usePolicyKnowledgeCheck(reviewing && isActionable(reviewing) ? reviewing.id : undefined);
  // Fail closed while the answer is unknown. Treating "not loaded yet" as "no check required" would
  // enable the attest button for a moment on every open, and clicking in that window earns a 403
  // from the server-side gate -- while PolicyKnowledgeCheck is simultaneously telling the reader it
  // can't be attested right now.
  const requiresKnowledgeCheck =
    knowledgeCheckLoading || knowledgeCheckError || (knowledgeCheckQuestions?.length ?? 0) > 0;

  const campaignById = useMemo(() => new Map((campaigns ?? []).map((c) => [c.id, c])), [campaigns]);
  const documentById = useMemo(() => new Map((documents ?? []).map((d) => [d.id, d])), [documents]);
  const versionById = useMemo(() => new Map((versions ?? []).map((v) => [v.id, v])), [versions]);

  const titleFor = (a: PolicyAttestation) => {
    const campaign = campaignById.get(a.campaign_id);
    const doc = campaign ? documentById.get(campaign.policy_document_id) : undefined;
    return doc?.title ?? campaign?.name ?? "Policy document";
  };

  const sorted = (attestations ?? []).slice().sort((a, b) => {
    if (isActionable(a) !== isActionable(b)) return isActionable(a) ? -1 : 1;
    return (a.due_date ?? "9999-99-99").localeCompare(b.due_date ?? "9999-99-99");
  });

  const isLoading = employeeLoading || attestationsLoading;

  const openReview = async (a: PolicyAttestation) => {
    setReviewing(a);
    setPdfUrl(null);
    setKnowledgeCheckPassed(false);
    const version = versionById.get(a.policy_document_version_id);
    if (!version) return;
    setLoadingPdf(true);
    try {
      // Longer TTL than the list-page default: the reader has to get through the whole
      // document inside this dialog before the "read and understood" step.
      const url = await getSignedUrl({ version, ttlSeconds: 600 });
      setPdfUrl(url);
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't load document", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoadingPdf(false);
    }
  };

  const handleAttest = async () => {
    if (!reviewing) return;
    try {
      await attestPolicy(reviewing.id);
      toast({ title: "Attestation recorded", description: `You've confirmed you read and understood "${titleFor(reviewing)}".` });
      setReviewing(null);
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't record attestation", description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Attestations</h1>
        <p className="text-muted-foreground">Policies and procedures that require your review and sign-off.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5" /> Attestations ({isLoading ? "—" : (attestations?.length ?? 0)})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {attestationsError ? (
            <QueryError what="your attestations" error={attestationsErrorDetail} onRetry={() => refetchAttestations()} />
          ) : isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}
            </div>
          ) : !sorted.length ? (
            <p className="text-muted-foreground text-sm text-center py-8">No policies are awaiting your attestation.</p>
          ) : (
            <div className="space-y-2">
              {sorted.map((a) => {
                const actionable = isActionable(a);
                const dueDistance = actionable ? formatDueDistance(a.due_date) : null;
                const daysLeft = actionable ? facilityDaysUntil(a.due_date) : null;
                const dueTone =
                  daysLeft !== null && daysLeft < 0
                    ? "text-destructive font-medium"
                    : daysLeft !== null && daysLeft <= 7
                      ? "text-amber-600 font-medium"
                      : "";
                return (
                <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{titleFor(a)}</p>
                    <p className={`text-xs ${dueTone || "text-muted-foreground"}`}>
                      {a.status === "attested"
                        ? `Attested ${fmtDate(facilityDateOf(a.attested_at))}`
                        : a.superseded_at
                          ? "A newer version of this policy was published — you will be assigned that one instead."
                          : `Due ${fmtDate(a.due_date)}${dueDistance ? ` · ${dueDistance}` : ""}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AttestationBadge attestation={a} />
                    <Button variant={actionable ? "default" : "outline"} onClick={() => openReview(a)}>
                      {actionable ? "Review & Attest" : "View"}
                    </Button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reviewing} onOpenChange={(o) => { if (!o) setReviewing(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{reviewing ? titleFor(reviewing) : ""}</DialogTitle>
            <DialogDescription>
              Please read the full document before attesting. By clicking "I Have Read and Understood" below, you
              agree to conduct this transaction electronically and confirm this constitutes your legal signature.
            </DialogDescription>
          </DialogHeader>

          {loadingPdf ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : pdfUrl ? (
            <div className="space-y-2">
              <iframe
                src={pdfUrl}
                title={reviewing ? titleFor(reviewing) : "Policy document"}
                className="h-[60vh] w-full rounded-md border bg-muted"
              />
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Trouble viewing? Open in a new tab
              </a>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Document unavailable.</p>
          )}

          {reviewing && isActionable(reviewing) && (
            <PolicyKnowledgeCheck
              attestationId={reviewing.id}
              onPassed={() => setKnowledgeCheckPassed(true)}
            />
          )}

          {reviewing?.superseded_at && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              This version was replaced on {fmtDate(facilityDateOf(reviewing.superseded_at))}. It is
              kept here so you can see what you were asked to read, but it can no longer be signed —
              your organization will assign the current version.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>Cancel</Button>
            {reviewing && isActionable(reviewing) && (
              // The attestation is a legal signature -- never allow sign-off
              // unless the document actually loaded and could be read, and (when the campaign has
              // one) the knowledge check has been passed. This disabled state is a courtesy, not
              // the control: attest-policy refuses the same case server-side, so a caller that
              // skips this UI entirely still cannot attest without a passing attempt on record.
              <Button
                onClick={handleAttest}
                disabled={attesting || !pdfUrl || (requiresKnowledgeCheck && !knowledgeCheckPassed)}
              >
                {attesting ? "Recording..." : "I Have Read and Understood"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
