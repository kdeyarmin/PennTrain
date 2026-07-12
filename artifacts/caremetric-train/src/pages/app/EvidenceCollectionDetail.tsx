import { useState } from "react";
import { Link, useParams } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  useEvidenceCollection,
  useEvidenceArtifacts,
  useEvidenceGrants,
  useEvidenceAccessEvents,
  usePromotableBinderExports,
  useAddBinderExportToCollection,
  useSetEvidenceCollectionStatus,
  useSetEvidenceLegalHold,
  useWithdrawEvidenceArtifact,
  useIssueEvidenceGuestGrant,
  useRevokeEvidenceGuestGrant,
  type EvidenceArtifact,
  type EvidenceGuestGrant,
  type IssuedGuestGrant,
} from "@/hooks/useEvidenceRoom";
import { EvidenceStatusPill } from "@/pages/app/EvidenceRoom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { formatDateForDisplay } from "@/lib/dateUtils";
import {
  ArrowLeft, Copy, FileCheck2, FolderLock, History, Link2, Loader2, Plus, Scale, ShieldOff, Undo2,
} from "lucide-react";

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  view: "Room viewed",
  download: "Downloaded",
  comment: "Commented",
  share: "Shared",
  denied: "Access denied",
  revoked: "Access revoked",
  withdrawn: "Artifact withdrawn",
  terms_accepted: "Terms accepted",
};

function grantState(grant: EvidenceGuestGrant): { label: string; className: string } {
  if (grant.revoked_at) return { label: "Revoked", className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" };
  if (new Date(grant.expires_at) <= new Date()) return { label: "Expired", className: "bg-muted text-muted-foreground" };
  if (!grant.accepted_at) return { label: "Awaiting terms", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" };
  return { label: "Active", className: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" };
}

export default function EvidenceCollectionDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: collection, isLoading, isError, error, refetch } = useEvidenceCollection(id);
  const { data: artifacts } = useEvidenceArtifacts(id);
  const { data: grants } = useEvidenceGrants(id);
  const { data: events } = useEvidenceAccessEvents(id);
  const { data: promotableExports } = usePromotableBinderExports(collection?.facility_id);

  const addExport = useAddBinderExportToCollection();
  const setStatus = useSetEvidenceCollectionStatus();
  const setLegalHold = useSetEvidenceLegalHold();
  const withdrawArtifact = useWithdrawEvidenceArtifact();
  const issueGrant = useIssueEvidenceGuestGrant();
  const revokeGrant = useRevokeEvidenceGuestGrant();

  const [showAddExport, setShowAddExport] = useState(false);
  const [exportJobId, setExportJobId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [withdrawTarget, setWithdrawTarget] = useState<EvidenceArtifact | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [showIssueGrant, setShowIssueGrant] = useState(false);
  const [guestLabel, setGuestLabel] = useState("");
  const [expiresDays, setExpiresDays] = useState("14");
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [issuedGrant, setIssuedGrant] = useState<IssuedGuestGrant | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<EvidenceGuestGrant | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [statusTarget, setStatusTarget] = useState<"closed" | "withdrawn" | null>(null);

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const canLegalHold = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  if (isLoading) {
    return <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-lg" />)}</div>;
  }
  if (isError || !collection) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/evidence"><ArrowLeft className="h-4 w-4 mr-1" /> Evidence Room</Link>
        </Button>
        <QueryError what="this evidence collection" error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const activeArtifacts = (artifacts ?? []).filter((a) => !a.withdrawn_at);

  const guestLinkFor = (token: string) => `${window.location.origin}/evidence-access/${token}`;

  const copyGuestLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(guestLinkFor(token));
      toast({ title: "Guest link copied" });
    } catch {
      toast({ title: "Could not copy", description: "Select and copy the link manually.", variant: "destructive" });
    }
  };

  const handleAddExport = () => {
    addExport.mutate(
      { collectionId: collection.id, binderJobId: exportJobId, displayName: displayName.trim() },
      {
        onSuccess: () => {
          setShowAddExport(false);
          setExportJobId("");
          setDisplayName("");
          toast({ title: "Export added to the collection" });
        },
        onError: (err) => toast({ title: "Could not add the export", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleStatus = (status: "published" | "closed" | "withdrawn") => {
    setStatus.mutate(
      { collectionId: collection.id, status },
      {
        onSuccess: () => {
          setStatusTarget(null);
          toast({
            title: status === "published" ? "Collection published" : `Collection ${status}`,
            description:
              status === "published"
                ? "You can now issue guest links to surveyors."
                : "All outstanding guest links were revoked.",
          });
        },
        onError: (err) => toast({ title: "Status change failed", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleWithdraw = () => {
    if (!withdrawTarget) return;
    withdrawArtifact.mutate(
      { artifactId: withdrawTarget.id, reason: withdrawReason.trim() },
      {
        onSuccess: () => {
          setWithdrawTarget(null);
          setWithdrawReason("");
          toast({ title: "Artifact withdrawn", description: "Guests can no longer see or download it." });
        },
        onError: (err) => toast({ title: "Withdrawal failed", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleIssueGrant = () => {
    const expiresAt = new Date(Date.now() + Number(expiresDays) * 24 * 60 * 60 * 1000).toISOString();
    issueGrant.mutate(
      { collectionId: collection.id, guestLabel: guestLabel.trim(), artifactIds: selectedArtifactIds, expiresAt },
      {
        onSuccess: (grant) => {
          setIssuedGrant(grant);
          setGuestLabel("");
          setSelectedArtifactIds([]);
        },
        onError: (err) => toast({ title: "Could not issue the guest link", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleRevoke = () => {
    if (!revokeTarget) return;
    revokeGrant.mutate(
      { grantId: revokeTarget.id, reason: revokeReason.trim() },
      {
        onSuccess: () => {
          setRevokeTarget(null);
          setRevokeReason("");
          toast({ title: "Guest access revoked", description: "The link stops working immediately." });
        },
        onError: (err) => toast({ title: "Revocation failed", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/app/evidence"><ArrowLeft className="h-4 w-4 mr-1" /> Evidence Room</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FolderLock className="h-6 w-6 shrink-0" /> <span className="truncate">{collection.name}</span>
          </h1>
          <p className="text-muted-foreground">{collection.purpose}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <EvidenceStatusPill value={collection.status} />
            <Badge variant="outline">{collection.facility?.name ?? "Facility"}</Badge>
            {collection.legal_hold && (
              <Badge variant="outline" className="border-0 bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">
                <Scale className="h-3 w-3 mr-1" /> Legal hold
              </Badge>
            )}
            {collection.published_at && (
              <span className="text-xs text-muted-foreground">Published {formatDateForDisplay(collection.published_at)}</span>
            )}
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {collection.status === "draft" && (
              <Button
                onClick={() => handleStatus("published")}
                disabled={setStatus.isPending || activeArtifacts.length === 0}
                title={activeArtifacts.length === 0 ? "Add at least one export before publishing" : undefined}
              >
                {setStatus.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileCheck2 className="h-4 w-4 mr-1" />}
                Publish
              </Button>
            )}
            {collection.status === "published" && (
              <Button variant="outline" onClick={() => setStatusTarget("closed")} disabled={setStatus.isPending}>
                Close room
              </Button>
            )}
            {["draft", "published", "closed"].includes(collection.status) && (
              <Button variant="outline" onClick={() => setStatusTarget("withdrawn")} disabled={setStatus.isPending}>
                <Undo2 className="h-4 w-4 mr-1" /> Withdraw
              </Button>
            )}
            {canLegalHold && (
              <Button
                variant="outline"
                onClick={() =>
                  setLegalHold.mutate(
                    { collectionId: collection.id, hold: !collection.legal_hold },
                    {
                      onSuccess: (updated) =>
                        toast({ title: updated.legal_hold ? "Legal hold placed" : "Legal hold released" }),
                      onError: (err) => toast({ title: "Legal hold change failed", description: err.message, variant: "destructive" }),
                    },
                  )
                }
                disabled={setLegalHold.isPending}
              >
                <Scale className="h-4 w-4 mr-1" /> {collection.legal_hold ? "Release hold" : "Legal hold"}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Artifacts */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Artifacts</CardTitle>
            <CardDescription>
              Immutable, checksummed binder exports scoped to this facility. Withdrawing one removes it
              from every guest room immediately and is logged.
            </CardDescription>
          </div>
          {canManage && ["draft", "published"].includes(collection.status) && (
            <Button size="sm" onClick={() => { setShowAddExport(true); setDisplayName(""); setExportJobId(""); }}>
              <Plus className="h-4 w-4 mr-1" /> Add binder export
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {(artifacts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No artifacts yet. Generate a facility-scoped compliance binder, then add it here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[700px]">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Checksum (SHA-256)</th>
                    <th>Added</th>
                    <th>Status</th>
                    {canManage && <th className="w-28" />}
                  </tr>
                </thead>
                <tbody>
                  {(artifacts ?? []).map((a) => (
                    <tr key={a.id} className={a.withdrawn_at ? "opacity-60" : undefined}>
                      <td className="font-medium">{a.display_name}</td>
                      <td className="text-sm">{formatBytes(a.snapshot_artifact?.byte_size)}</td>
                      <td className="font-mono text-xs text-muted-foreground">
                        {a.snapshot_artifact?.content_sha256 ? `${a.snapshot_artifact.content_sha256.slice(0, 16)}…` : "—"}
                      </td>
                      <td className="text-sm text-muted-foreground">{formatDateForDisplay(a.added_at)}</td>
                      <td>
                        {a.withdrawn_at ? (
                          <Badge variant="outline" className="border-0 bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">Withdrawn</Badge>
                        ) : (
                          <Badge variant="outline" className="border-0 bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200">Active</Badge>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          {!a.withdrawn_at && (
                            <Button size="sm" variant="outline" onClick={() => { setWithdrawTarget(a); setWithdrawReason(""); }}>
                              <ShieldOff className="h-4 w-4 mr-1" /> Withdraw
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Guest access */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Guest access</CardTitle>
            <CardDescription>
              Expiring, revocable links for surveyors. Each link is scoped to selected artifacts, requires
              terms acceptance, and every view and download is logged below.
            </CardDescription>
          </div>
          {canManage && collection.status === "published" && (
            <Button
              size="sm"
              onClick={() => {
                setSelectedArtifactIds(activeArtifacts.map((a) => a.id));
                setGuestLabel("");
                setShowIssueGrant(true);
              }}
              disabled={activeArtifacts.length === 0}
            >
              <Plus className="h-4 w-4 mr-1" /> Issue guest link
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {collection.status === "draft" ? (
            <p className="text-sm text-muted-foreground py-4">Publish the collection to issue guest links.</p>
          ) : (grants ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No guest links issued yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[700px]">
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Scope</th>
                    <th>Expires</th>
                    <th>State</th>
                    <th>Issued</th>
                    {canManage && <th className="w-28" />}
                  </tr>
                </thead>
                <tbody>
                  {(grants ?? []).map((g) => {
                    const state = grantState(g);
                    return (
                      <tr key={g.id}>
                        <td className="font-medium">{g.guest_label}</td>
                        <td className="text-sm">{g.allowed_artifact_ids.length} artifact{g.allowed_artifact_ids.length === 1 ? "" : "s"}</td>
                        <td className="text-sm text-muted-foreground">{formatDateForDisplay(g.expires_at)}</td>
                        <td><Badge variant="outline" className={`border-0 font-medium ${state.className}`}>{state.label}</Badge></td>
                        <td className="text-sm text-muted-foreground">{formatDateForDisplay(g.created_at)}</td>
                        {canManage && (
                          <td>
                            {state.label !== "Revoked" && state.label !== "Expired" && (
                              <Button size="sm" variant="outline" onClick={() => { setRevokeTarget(g); setRevokeReason(""); }}>
                                Revoke
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Access log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Access log</CardTitle>
          <CardDescription>Append-only record of guest activity and staff withdrawals/revocations.</CardDescription>
        </CardHeader>
        <CardContent>
          {(events ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No access activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {(events ?? []).map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm border-b last:border-0 pb-2">
                  <Badge
                    variant="outline"
                    className={`border-0 font-medium ${e.event_type === "denied" ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-muted text-muted-foreground"}`}
                  >
                    {EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}
                  </Badge>
                  <span className="text-muted-foreground">{e.reason}</span>
                  <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.occurred_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add export dialog */}
      <Dialog open={showAddExport} onOpenChange={setShowAddExport}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a binder export</DialogTitle>
            <DialogDescription>
              Only completed, checksummed exports generated for {collection.facility?.name ?? "this facility"} can
              be promoted into the collection. Need a fresh one? Generate it from the Compliance Binder page
              with this facility selected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="evidence-export">Completed export</Label>
              <Select value={exportJobId} onValueChange={setExportJobId}>
                <SelectTrigger id="evidence-export"><SelectValue placeholder="Select an export" /></SelectTrigger>
                <SelectContent>
                  {(promotableExports ?? []).length === 0 ? (
                    <SelectItem value="none" disabled>No eligible exports for this facility</SelectItem>
                  ) : (
                    (promotableExports ?? []).map((job) => (
                      <SelectItem key={job.id} value={job.id}>
                        {job.completed_at ? new Date(job.completed_at).toLocaleString() : job.id.slice(0, 8)}
                        {" · "}{formatBytes(job.byte_size)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-display-name">Display name for guests</Label>
              <Input
                id="evidence-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="July 2026 compliance binder"
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddExport(false)}>Cancel</Button>
            <Button
              onClick={handleAddExport}
              disabled={addExport.isPending || !exportJobId || exportJobId === "none" || displayName.trim().length < 3}
            >
              {addExport.isPending ? "Adding…" : "Add to collection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Withdraw artifact dialog */}
      <Dialog open={!!withdrawTarget} onOpenChange={(open) => !open && setWithdrawTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw "{withdrawTarget?.display_name}"</DialogTitle>
            <DialogDescription>
              Guests lose access immediately. Withdrawal is logged and cannot be undone by re-adding the
              same export.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="withdraw-reason">Reason</Label>
            <Textarea
              id="withdraw-reason"
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              placeholder="Why is this artifact being withdrawn?"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleWithdraw}
              disabled={withdrawArtifact.isPending || withdrawReason.trim().length < 5}
            >
              {withdrawArtifact.isPending ? "Withdrawing…" : "Withdraw artifact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue grant dialog */}
      <Dialog
        open={showIssueGrant}
        onOpenChange={(open) => {
          if (!open) {
            setShowIssueGrant(false);
            setIssuedGrant(null);
          }
        }}
      >
        <DialogContent>
          {issuedGrant ? (
            <>
              <DialogHeader>
                <DialogTitle>Guest link ready</DialogTitle>
                <DialogDescription>
                  Copy it now -- for security only a hash is stored, so this link cannot be shown again.
                  Send it to the surveyor through your usual channel.
                </DialogDescription>
              </DialogHeader>
              <Alert>
                <AlertTitle className="break-all font-mono text-xs">{guestLinkFor(issuedGrant.token)}</AlertTitle>
                <AlertDescription>Expires {formatDateForDisplay(issuedGrant.expiresAt)}.</AlertDescription>
              </Alert>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowIssueGrant(false); setIssuedGrant(null); }}>Done</Button>
                <Button onClick={() => copyGuestLink(issuedGrant.token)}>
                  <Copy className="h-4 w-4 mr-1" /> Copy link
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Issue a guest link</DialogTitle>
                <DialogDescription>
                  The guest sees only the artifacts you select, must accept the confidentiality terms, and
                  loses access at expiry or on revocation.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="guest-label">Guest name or organization</Label>
                  <Input
                    id="guest-label"
                    value={guestLabel}
                    onChange={(e) => setGuestLabel(e.target.value)}
                    placeholder="DHS surveyor - J. Smith"
                    maxLength={120}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="guest-expiry">Expires in</Label>
                  <Select value={expiresDays} onValueChange={setExpiresDays}>
                    <SelectTrigger id="guest-expiry"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="14">14 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Shared artifacts</Label>
                  <div className="space-y-2 max-h-48 overflow-y-auto rounded-md border p-3">
                    {activeArtifacts.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedArtifactIds.includes(a.id)}
                          onCheckedChange={(checked) =>
                            setSelectedArtifactIds((prev) =>
                              checked ? [...prev, a.id] : prev.filter((existing) => existing !== a.id),
                            )
                          }
                        />
                        {a.display_name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowIssueGrant(false)}>Cancel</Button>
                <Button
                  onClick={handleIssueGrant}
                  disabled={issueGrant.isPending || guestLabel.trim().length < 2 || selectedArtifactIds.length === 0}
                >
                  {issueGrant.isPending ? "Issuing…" : "Issue link"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke grant dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke access for "{revokeTarget?.guest_label}"</DialogTitle>
            <DialogDescription>The link stops working immediately; the revocation is logged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">Reason</Label>
            <Textarea
              id="revoke-reason"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="Why is this access being revoked?"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={revokeGrant.isPending || revokeReason.trim().length < 5}
            >
              {revokeGrant.isPending ? "Revoking…" : "Revoke access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close/withdraw confirmation */}
      <Dialog open={!!statusTarget} onOpenChange={(open) => !open && setStatusTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{statusTarget === "closed" ? "Close this room?" : "Withdraw this collection?"}</DialogTitle>
            <DialogDescription>
              {statusTarget === "closed"
                ? "Closing marks the survey finished. Every outstanding guest link is revoked immediately and the revocations are logged."
                : "Withdrawing takes the collection out of circulation permanently. Every outstanding guest link is revoked immediately."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => statusTarget && handleStatus(statusTarget)}
              disabled={setStatus.isPending}
            >
              {setStatus.isPending ? "Working…" : statusTarget === "closed" ? "Close room" : "Withdraw collection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
