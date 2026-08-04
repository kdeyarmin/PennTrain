import { useId, useMemo, useState } from "react";
import {
  useAuditExportManifest,
  useCreateAuditLegalHold,
  useDataLifecycleStatus,
  useListAuditLegalHolds,
  usePlanAuditArchive,
  useReleaseAuditLegalHold,
  useRunDataLifecyclePolicy,
} from "@/hooks/useDataLifecycle";
import { archivePlanIssues, legalHoldWarning, shortDigest } from "@/lib/auditArchivePlan";
import { useListOrganizations } from "@/hooks/useOrganizations";
import { useListFacilities } from "@/hooks/useFacilities";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Archive, Scale } from "lucide-react";

export function DataLifecyclePanel() {
  const __fieldIds = useId();
  const { toast } = useToast();
  const statusQ = useDataLifecycleStatus();
  const holdsQ = useListAuditLegalHolds();
  const orgsQ = useListOrganizations();
  const facilitiesQ = useListFacilities();
  const createHold = useCreateAuditLegalHold();
  const releaseHold = useReleaseAuditLegalHold();
  const runPolicy = useRunDataLifecyclePolicy();
  const planArchive = usePlanAuditArchive();

  const [orgId, setOrgId] = useState("");
  const [facilityId, setFacilityId] = useState<string>("none");
  const [reason, setReason] = useState("Legal hold placed from Security & Governance console");
  const [busy, setBusy] = useState(false);
  const [archiveFrom, setArchiveFrom] = useState("");
  const [archiveTo, setArchiveTo] = useState("");
  const [archiveOrgId, setArchiveOrgId] = useState("all");
  const [plannedBatchId, setPlannedBatchId] = useState<string | null>(null);

  const facilitiesForOrg = useMemo(
    () => (facilitiesQ.data ?? []).filter((f) => !orgId || f.organization_id === orgId),
    [facilitiesQ.data, orgId],
  );

  const activeHolds = (holdsQ.data ?? []).filter((h) => !h.released_at);

  // The date inputs give calendar days; the RPC takes instants. Taking the whole of the end day
  // rather than its midnight means "to 31 January" includes 31 January, which is what it reads as.
  const archiveRange = archiveFrom && archiveTo
    ? { from: `${archiveFrom}T00:00:00.000Z`, to: `${archiveTo}T23:59:59.999Z` }
    : null;
  const archiveScopeOrgId = archiveOrgId === "all" ? null : archiveOrgId;
  const manifestQ = useAuditExportManifest({
    from: archiveRange?.from ?? "",
    to: archiveRange?.to ?? "",
    organizationId: archiveScopeOrgId,
  });
  const archiveIssues = archivePlanIssues(
    { from: archiveRange?.from ?? "", to: archiveRange?.to ?? "" },
    manifestQ.data?.rowCount ?? null,
  );
  const holdWarning = legalHoldWarning(activeHolds.length, archiveScopeOrgId !== null);

  const handlePlanArchive = async () => {
    if (!archiveRange) return;
    try {
      setBusy(true);
      const batchId = await planArchive.mutateAsync({
        from: archiveRange.from,
        to: archiveRange.to,
        organizationId: archiveScopeOrgId,
      });
      setPlannedBatchId(batchId);
      toast({ title: "Archive batch planned", description: `${manifestQ.data?.rowCount ?? 0} rows frozen for export.` });
    } catch (e) {
      toast({ title: "Could not plan the archive", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!orgId || reason.trim().length < 8) {
      toast({ title: "Organization and reason (8+ chars) required", variant: "destructive" });
      return;
    }
    try {
      setBusy(true);
      await createHold.mutateAsync({
        organizationId: orgId,
        facilityId: facilityId === "none" ? null : facilityId,
        reason: reason.trim(),
      });
      toast({ title: "Legal hold placed" });
    } catch (e) {
      toast({ title: "Could not place hold", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleRelease = async (holdId: string) => {
    const releaseReason = window.prompt("Release reason (min 8 characters)", "Hold released from Security & Governance");
    if (!releaseReason || releaseReason.trim().length < 8) return;
    try {
      setBusy(true);
      await releaseHold.mutateAsync({ holdId, reason: releaseReason.trim() });
      toast({ title: "Legal hold released" });
    } catch (e) {
      toast({ title: "Could not release hold", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleRun = async (policyKey: string) => {
    try {
      setBusy(true);
      await runPolicy.mutateAsync({ policyKey, limit: 100 });
      toast({ title: "Lifecycle policy run started", description: policyKey });
    } catch (e) {
      toast({ title: "Policy run failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (statusQ.isError) {
    return <QueryError what="data lifecycle status" error={statusQ.error as Error} onRetry={() => void statusQ.refetch()} />;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Scale className="h-7 w-7 text-violet-600" />
            <div>
              <p className="text-2xl font-bold">{activeHolds.length}</p>
              <p className="text-sm text-muted-foreground">Active audit legal holds</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Archive className="h-7 w-7 text-blue-600" />
            <div>
              <p className="text-2xl font-bold">{statusQ.data?.archiveRows ?? 0}</p>
              <p className="text-sm text-muted-foreground">Archived retained rows</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Archive className="h-7 w-7 text-slate-600" />
            <div>
              <p className="text-2xl font-bold">{statusQ.data?.policies?.length ?? 0}</p>
              <p className="text-sm text-muted-foreground">Active lifecycle policies</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Place audit legal hold</CardTitle>
          <CardDescription>Platform admin only. Blocks archival/deletion for the scoped organization (and optional facility).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${__fieldIds}-organization`}>Organization</Label>
            <Select value={orgId} onValueChange={(v) => { setOrgId(v); setFacilityId("none"); }}>
              <SelectTrigger id={`${__fieldIds}-organization`}><SelectValue placeholder="Select organization" /></SelectTrigger>
              <SelectContent>
                {(orgsQ.data ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${__fieldIds}-facility-optional`}>Facility (optional)</Label>
            <Select value={facilityId} onValueChange={setFacilityId}>
              <SelectTrigger id={`${__fieldIds}-facility-optional`}><SelectValue placeholder="All facilities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All facilities in org</SelectItem>
                {facilitiesForOrg.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor={`${__fieldIds}-reason`}>Reason</Label>
            <Input id={`${__fieldIds}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div>
            <Button onClick={() => void handleCreate()} disabled={busy}>Place hold</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active legal holds</CardTitle>
        </CardHeader>
        <CardContent>
          {holdsQ.isError ? (
            <QueryError what="legal holds" error={holdsQ.error as Error} onRetry={() => void holdsQ.refetch()} />
          ) : holdsQ.isLoading ? (
            <div className="h-16 animate-pulse rounded bg-muted" />
          ) : !activeHolds.length ? (
            <p className="text-sm text-muted-foreground">No active holds.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeHolds.map((h) => {
                  const orgName = (orgsQ.data ?? []).find((o) => o.id === h.organization_id)?.name ?? h.organization_id ?? "Platform-wide";
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="text-sm">{orgName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-md truncate">{h.reason}</TableCell>
                      <TableCell className="text-xs">{new Date(h.starts_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleRelease(h.id)}>Release</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan an audit archive</CardTitle>
          <CardDescription>
            Freezes a date range, hashes what it contains, and records whether a legal hold covers it. The
            plan writes nothing to the audit log itself — it is the batch an export is later made from.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${__fieldIds}-archive-from`}>From</Label>
            <Input id={`${__fieldIds}-archive-from`} type="date" value={archiveFrom} onChange={(e) => setArchiveFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${__fieldIds}-archive-to`}>To</Label>
            <Input id={`${__fieldIds}-archive-to`} type="date" value={archiveTo} onChange={(e) => setArchiveTo(e.target.value)} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor={`${__fieldIds}-archive-org`}>Scope</Label>
            <Select value={archiveOrgId} onValueChange={setArchiveOrgId}>
              <SelectTrigger id={`${__fieldIds}-archive-org`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every organization (platform-wide)</SelectItem>
                {(orgsQ.data ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 space-y-2">
            {manifestQ.data && (
              <p className="text-sm">
                {manifestQ.data.rowCount.toLocaleString()} audit rows · manifest {shortDigest(manifestQ.data.sha256)}
              </p>
            )}
            {manifestQ.isLoading && archiveRange && <p className="text-sm text-muted-foreground">Counting rows…</p>}
            {holdWarning && <p className="text-xs text-amber-700">{holdWarning}</p>}
            {archiveIssues.map((issue) => <p key={issue} className="text-xs text-muted-foreground">{issue}</p>)}
            {plannedBatchId && (
              <p className="text-xs text-muted-foreground">Planned batch {plannedBatchId.slice(0, 8)}…</p>
            )}
            <Button
              // `!manifestQ.data` is load-bearing, not belt-and-braces: until the count arrives,
              // archivePlanIssues is handed a null rowCount and cannot report an empty range, and
              // plan_audit_archive records a zero-row batch rather than refusing one. Clicking
              // during the count is exactly how the empty batch this form guards against gets made.
              disabled={busy || archiveIssues.length > 0 || planArchive.isPending || !manifestQ.data}
              onClick={() => void handlePlanArchive()}
            >
              <Archive className="mr-2 h-4 w-4" />Plan archive batch
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle policies</CardTitle>
          <CardDescription>Run a policy batch (limit 100) after reviewing holds. Nightly cron also runs these.</CardDescription>
        </CardHeader>
        <CardContent>
          {statusQ.isLoading ? (
            <div className="h-16 animate-pulse rounded bg-muted" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Disposition</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(statusQ.data?.policies ?? []).map((p) => (
                  <TableRow key={p.policyKey}>
                    <TableCell className="font-mono text-xs">{p.policyKey}</TableCell>
                    <TableCell className="text-sm">{p.table}</TableCell>
                    <TableCell><Badge variant="outline">{p.disposition}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.lastRun
                        ? `${p.lastRun.status} · archived ${p.lastRun.archived ?? 0} · deleted ${p.lastRun.deleted ?? 0}`
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleRun(p.policyKey)}>
                        Run now
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
