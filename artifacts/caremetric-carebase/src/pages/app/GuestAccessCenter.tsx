import { useId, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, ShieldOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useToast } from "@/hooks/use-toast";
import { useUrlState } from "@/hooks/useUrlState";
import { useGuestAccessGrants, type GrantKind, type GrantStatus, type UnifiedGrant } from "@/hooks/useGuestAccessGrants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { formatDateForDisplay } from "@/lib/dateUtils";

const KIND_LABEL: Record<GrantKind, string> = {
  evidence: "Evidence room",
  move_in: "Move-in",
  agreement: "Resident agreement",
  portal: "Resident portal",
};

const FILTER_DEFAULTS = { kind: "all", status: "active" };

function isActive(grant: UnifiedGrant) {
  if (grant.revokedAt) return false;
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

export default function GuestAccessCenter() {
  const __fieldIds = useId();
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useUrlState(FILTER_DEFAULTS);
  const kindFilter = Object.hasOwn(KIND_LABEL, filters.kind) ? filters.kind as GrantKind : "all";
  const statusFilter: GrantStatus = filters.status === "inactive" || filters.status === "all" ? filters.status : "active";
  const [revokeTarget, setRevokeTarget] = useState<UnifiedGrant | null>(null);
  const [reason, setReason] = useState("");
  const [revoking, setRevoking] = useState(false);

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const orgId = viewingOrgId ?? user?.organizationId ?? undefined;
  // /app/residents/:id refuses the platform operator; their resident detail is mounted under
  // /admin. Evidence and move-in workspaces admit every role that can open this page.
  const residentBase = user?.role === "platform_admin" ? "/admin/residents" : "/app/residents";

  const grantsQuery = useGuestAccessGrants({ organizationId: orgId ?? "", kind: kindFilter, status: statusFilter, residentBase }, user?.id);
  const filtered = useMemo(() => {
    const rows = grantsQuery.data?.pages.flatMap(page => page.rows) ?? [];
    // Hide grants that expired between a successful read and this render.
    return statusFilter === "active" ? rows.filter(isActive) : rows;
  }, [grantsQuery.data, statusFilter]);
  const activeCount = filtered.filter(isActive).length;
  const unavailable = !orgId || grantsQuery.isLoading || (grantsQuery.isError && !grantsQuery.isFetchNextPageError);

  const revoke = async () => {
    if (!revokeTarget || reason.trim().length < 5) return;
    setRevoking(true);
    try {
      const rpc =
        revokeTarget.kind === "evidence"
          ? "revoke_evidence_guest_grant"
          : revokeTarget.kind === "move_in"
            ? "revoke_move_in_guest_grant"
            : revokeTarget.kind === "agreement"
              ? "revoke_resident_agreement_guest_grant"
              : "revoke_resident_portal_grant";
      const { error } = await (supabase as any).rpc(rpc, {
        p_grant_id: revokeTarget.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      toast({ title: "Guest access revoked" });
      setRevokeTarget(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["guest-access-center"] });
    } catch (err) {
      toast({
        title: "Could not revoke grant",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="flex items-center gap-2"><KeyRound className="h-6 w-6" /> Guest access center</h1>
        <p className="text-muted-foreground">
          Review and revoke guest access to evidence rooms, move-in workspaces, agreements, and resident portals.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-2xl font-bold">{unavailable ? "—" : filtered.length}</p><p className="text-sm text-muted-foreground">Matching grants loaded</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-2xl font-bold">{unavailable ? "—" : activeCount}</p><p className="text-sm text-muted-foreground">Active grants loaded</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-2xl font-bold">{canManage ? "Revoke" : "View"}</p><p className="text-sm text-muted-foreground">{canManage ? "Managers may revoke with reason" : "Read-only for auditors"}</p></CardContent></Card>
      </div>

      <div className="filter-bar premium-card flex flex-wrap gap-2">
        <Select value={kindFilter} onValueChange={kind => setFilters({ kind })}>
          <SelectTrigger className="w-48" aria-label="Grant type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All grant types</SelectItem>
            {(Object.keys(KIND_LABEL) as GrantKind[]).map((k) => (
              <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={status => setFilters({ status })}>
          <SelectTrigger className="w-40" aria-label="Grant status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="inactive">Revoked / expired</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>External access grants</CardTitle>
          <CardDescription>Newest first. Load older grants below, or open the parent record to issue new access.</CardDescription>
        </CardHeader>
        <CardContent>
          {!orgId ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Select an organization to review guest access.</p>
          ) : grantsQuery.isError && !grantsQuery.isFetchNextPageError ? (
            <QueryError what="guest access grants" error={grantsQuery.error} onRetry={() => grantsQuery.refetch()} />
          ) : grantsQuery.isLoading ? (
            <QueryLoading what="guest access grants" />
          ) : filtered.length === 0 ? (
            <div className="space-y-3 py-10 text-center">
              <p className="text-sm text-muted-foreground">No guest grants match these filters.</p>
              {(kindFilter !== "all" || statusFilter !== "all") && <Button variant="outline" onClick={() => setFilters({ kind: "all", status: "all" })}>Show all grants</Button>}
              <p className="text-sm text-muted-foreground">Create guest access from an evidence collection, move-in workspace, or resident record.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((grant) => {
                const active = isActive(grant);
                return (
                  <div key={`${grant.kind}-${grant.id}`} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words font-medium [overflow-wrap:anywhere]">{grant.label}</p>
                        <Badge variant="outline">{KIND_LABEL[grant.kind]}</Badge>
                        <Badge variant={active ? "default" : "secondary"}>{active ? "Active" : grant.revokedAt ? "Revoked" : "Expired"}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Issued {grant.createdAt ? formatDateForDisplay(grant.createdAt) : "—"}
                        {grant.expiresAt ? ` · Expires ${formatDateForDisplay(grant.expiresAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={grant.parentHref}><ExternalLink className="mr-1 h-3.5 w-3.5" />{grant.parentLabel}</Link>
                      </Button>
                      {canManage && active && (
                        <Button size="sm" variant="destructive" aria-label={`Revoke access for ${grant.label}`} onClick={() => { setRevokeTarget(grant); setReason(""); }}>
                          <ShieldOff className="mr-1 h-3.5 w-3.5" /> Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!unavailable && orgId && (
            <div className="mt-5 space-y-3 border-t pt-4">
              <p className="text-sm text-muted-foreground" role="status">
                {filtered.length} matching {filtered.length === 1 ? "grant" : "grants"} loaded{grantsQuery.hasNextPage ? ". Older grants are available." : ". All matching grants loaded."}
              </p>
              {grantsQuery.isFetchNextPageError && <p role="alert" className="text-sm text-destructive">Could not load older grants. Your current results are still available. Try again.</p>}
              {grantsQuery.hasNextPage && <Button variant="outline" disabled={grantsQuery.isFetching} onClick={() => void grantsQuery.fetchNextPage()}>
                {grantsQuery.isFetchingNextPage ? "Loading older grants…" : grantsQuery.isFetchNextPageError ? "Retry loading older grants" : "Load older grants"}
              </Button>}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke guest access</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {revokeTarget ? `${revokeTarget.label} (${KIND_LABEL[revokeTarget.kind]}) will stop working immediately.` : ""}
          </p>
          <div className="space-y-2">
            <Label htmlFor={`${__fieldIds}-reason`}>Reason * (at least 5 characters)</Label>
            <Input id={`${__fieldIds}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Survey complete; access no longer needed" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={revoking || reason.trim().length < 5} onClick={() => void revoke()}>
              {revoking ? "Revoking…" : "Revoke access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
