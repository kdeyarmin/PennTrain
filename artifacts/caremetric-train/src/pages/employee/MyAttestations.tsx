import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import {
  useListPolicyAttestations,
  useListPolicyAttestationCampaigns,
  useAttestPolicy,
  type PolicyAttestation,
} from "@/hooks/usePolicyAttestations";
import { useListPolicyDocuments, useListPolicyDocumentVersionsForOrg, usePolicyDocumentSignedUrl } from "@/hooks/usePolicyDocuments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FileCheck2, ExternalLink, Loader2 } from "lucide-react";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function AttestationBadge({ attestation }: { attestation: PolicyAttestation }) {
  if (attestation.status === "attested") {
    return <Badge className="bg-success text-success-foreground hover:bg-success/80">Attested</Badge>;
  }
  if (attestation.due_date && attestation.due_date < new Date().toISOString().slice(0, 10)) {
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
  const { data: attestations, isLoading: attestationsLoading } = useListPolicyAttestations(
    { employeeId: employee?.id },
    { enabled: !!employee?.id },
  );
  const { data: campaigns } = useListPolicyAttestationCampaigns({ organizationId: user?.organizationId ?? undefined });
  const { data: documents } = useListPolicyDocuments({ organizationId: user?.organizationId ?? undefined });
  const { data: versions } = useListPolicyDocumentVersionsForOrg(user?.organizationId ?? undefined);
  const { mutateAsync: getSignedUrl } = usePolicyDocumentSignedUrl();
  const { mutateAsync: attestPolicy, isPending: attesting } = useAttestPolicy();

  const [reviewing, setReviewing] = useState<PolicyAttestation | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const campaignById = useMemo(() => new Map((campaigns ?? []).map((c) => [c.id, c])), [campaigns]);
  const documentById = useMemo(() => new Map((documents ?? []).map((d) => [d.id, d])), [documents]);
  const versionById = useMemo(() => new Map((versions ?? []).map((v) => [v.id, v])), [versions]);

  const titleFor = (a: PolicyAttestation) => {
    const campaign = campaignById.get(a.campaign_id);
    const doc = campaign ? documentById.get(campaign.policy_document_id) : undefined;
    return doc?.title ?? campaign?.name ?? "Policy document";
  };

  const sorted = (attestations ?? []).slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return (a.due_date ?? "9999-99-99").localeCompare(b.due_date ?? "9999-99-99");
  });

  const isLoading = employeeLoading || attestationsLoading;

  const openReview = async (a: PolicyAttestation) => {
    setReviewing(a);
    setPdfUrl(null);
    const version = versionById.get(a.policy_document_version_id);
    if (!version) return;
    setLoadingPdf(true);
    try {
      const url = await getSignedUrl(version);
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
            <FileCheck2 className="h-5 w-5" /> Attestations ({attestations?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}
            </div>
          ) : !sorted.length ? (
            <p className="text-muted-foreground text-sm text-center py-8">No policies are awaiting your attestation.</p>
          ) : (
            <div className="space-y-2">
              {sorted.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{titleFor(a)}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.status === "attested" ? `Attested ${fmtDate(a.attested_at?.slice(0, 10) ?? null)}` : `Due ${fmtDate(a.due_date)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AttestationBadge attestation={a} />
                    <Button variant={a.status === "pending" ? "default" : "outline"} onClick={() => openReview(a)}>
                      {a.status === "pending" ? "Review & Attest" : "View"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reviewing} onOpenChange={(o) => { if (!o) setReviewing(null); }}>
        <DialogContent className="sm:max-w-lg">
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
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" /> Open document in a new tab
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">Document unavailable.</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>Cancel</Button>
            {reviewing?.status === "pending" && (
              <Button onClick={handleAttest} disabled={attesting}>
                {attesting ? "Recording..." : "I Have Read and Understood"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
