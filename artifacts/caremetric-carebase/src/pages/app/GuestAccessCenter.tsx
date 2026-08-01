import { useId, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, ShieldOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { formatDateForDisplay } from "@/lib/dateUtils";

type GrantKind = "evidence" | "move_in" | "agreement" | "portal";

interface UnifiedGrant {
  kind: GrantKind;
  id: string;
  label: string;
  facilityLabel?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string | null;
  parentHref: string;
  parentLabel: string;
}

const KIND_LABEL: Record<GrantKind, string> = {
  evidence: "Evidence room",
  move_in: "Move-in",
  agreement: "Resident agreement",
  portal: "Resident portal",
};

/** Per-table row cap. Each source is fetched separately, so a full page means "there may be more". */
const GRANT_PAGE_SIZE = 200;

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
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [revokeTarget, setRevokeTarget] = useState<UnifiedGrant | null>(null);
  const [reason, setReason] = useState("");
  const [revoking, setRevoking] = useState(false);

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const orgId = viewingOrgId ?? user?.organizationId ?? undefined;

  const grantsQuery = useQuery({
    queryKey: ["guest-access-center", orgId, statusFilter],
    enabled: !!orgId,
    queryFn: async (): Promise<{ rows: UnifiedGrant[]; truncated: boolean }> => {
      // Status has to be decided on the server. Each table is capped at GRANT_PAGE_SIZE newest
      // rows, so filtering to Active only after the fetch means a long-lived grant that happens to
      // be older than a page full of revoked ones never appears -- and a grant nobody can see is a
      // grant nobody can revoke, which is the whole purpose of this page.
      const nowIso = new Date().toISOString();
      const scopeStatus = <T extends { is: any; or: any }>(query: T): T => {
        if (statusFilter === "active") {
          return query.is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${nowIso}`) as T;
        }
        if (statusFilter === "inactive") {
          return query.or(`revoked_at.not.is.null,expires_at.lte.${nowIso}`) as T;
        }
        return query;
      };

      const [evidence, moveIn, agreements, portals] = await Promise.all([
        scopeStatus(
          supabase
            .from("evidence_guest_grants")
            .select("id, guest_label, expires_at, revoked_at, created_at, collection_id, organization_id")
            .eq("organization_id", orgId!),
        )
          .order("created_at", { ascending: false })
          .limit(GRANT_PAGE_SIZE),
        scopeStatus(
          supabase
            .from("move_in_guest_grants")
            .select("id, guest_label, expires_at, revoked_at, created_at, workspace_id, organization_id")
            .eq("organization_id", orgId!),
        )
          .order("created_at", { ascending: false })
          .limit(GRANT_PAGE_SIZE),
        scopeStatus(
          supabase
            .from("resident_agreement_guest_grants")
            .select("id, guest_label, expires_at, revoked_at, created_at, resident_id, organization_id")
            .eq("organization_id", orgId!),
        )
          .order("created_at", { ascending: false })
          .limit(GRANT_PAGE_SIZE),
        scopeStatus(
          supabase
            .from("resident_portal_grants")
            .select("id, designated_person_name, relationship_label, expires_at, revoked_at, created_at, resident_id, organization_id")
            .eq("organization_id", orgId!),
        )
          .order("created_at", { ascending: false })
          .limit(GRANT_PAGE_SIZE),
      ]);

      const firstError = evidence.error ?? moveIn.error ?? agreements.error ?? portals.error;
      if (firstError) throw firstError;

      const rows: UnifiedGrant[] = [
        ...(evidence.data ?? []).map((g: any) => ({
          kind: "evidence" as const,
          id: g.id,
          label: g.guest_label ?? "Evidence guest",
          expiresAt: g.expires_at,
          revokedAt: g.revoked_at,
          createdAt: g.created_at,
          parentHref: `/app/evidence/${g.collection_id}`,
          parentLabel: "Open evidence collection",
        })),
        ...(moveIn.data ?? []).map((g: any) => ({
          kind: "move_in" as const,
          id: g.id,
          label: g.guest_label ?? "Move-in guest",
          expiresAt: g.expires_at,
          revokedAt: g.revoked_at,
          createdAt: g.created_at,
          parentHref: `/app/admissions/move-ins/${g.workspace_id}`,
          parentLabel: "Open move-in workspace",
        })),
        ...(agreements.data ?? []).map((g: any) => ({
          kind: "agreement" as const,
          id: g.id,
          label: g.guest_label ?? "Agreement signer",
          expiresAt: g.expires_at,
          revokedAt: g.revoked_at,
          createdAt: g.created_at,
          parentHref: `/app/residents/${g.resident_id}`,
          parentLabel: "Open resident",
        })),
        ...(portals.data ?? []).map((g: any) => ({
          kind: "portal" as const,
          id: g.id,
          label: g.designated_person_name
            ? `${g.designated_person_name}${g.relationship_label ? ` (${g.relationship_label})` : ""}`
            : "Portal guest",
          expiresAt: g.expires_at,
          revokedAt: g.revoked_at,
          createdAt: g.created_at,
          parentHref: `/app/residents/${g.resident_id}`,
          parentLabel: "Open resident",
        })),
      ];

      // A source that came back exactly full may have more behind it. Say so rather than let the
      // list read as complete.
      const truncated = [evidence, moveIn, agreements, portals].some(
        (result) => (result.data ?? []).length >= GRANT_PAGE_SIZE,
      );

      return {
        rows: rows.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))),
        truncated,
      };
    },
  });

  const filtered = useMemo(() => {
    let rows = grantsQuery.data?.rows ?? [];
    if (kindFilter !== "all") rows = rows.filter((r) => r.kind === kindFilter);
    // Status is already scoped server-side; re-applying it here only trims rows that crossed their
    // expiry between the query and this render.
    if (statusFilter === "active") rows = rows.filter(isActive);
    if (statusFilter === "inactive") rows = rows.filter((r) => !isActive(r));
    return rows;
  }, [grantsQuery.data, kindFilter, statusFilter]);

  const activeCount = (grantsQuery.data?.rows ?? []).filter(isActive).length;

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
          Review and revoke external tokens for evidence rooms, move-in workspaces, agreements, and resident portals.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-2xl font-bold">{grantsQuery.data?.rows.length ?? "—"}</p><p className="text-sm text-muted-foreground">Grants in view</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-2xl font-bold">{grantsQuery.isLoading ? "—" : activeCount}</p><p className="text-sm text-muted-foreground">Active in view</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-2xl font-bold">{canManage ? "Revoke" : "View"}</p><p className="text-sm text-muted-foreground">{canManage ? "Managers may revoke with reason" : "Read-only for auditors"}</p></CardContent></Card>
      </div>

      {grantsQuery.data?.truncated ? (
        <p className="text-sm text-amber-700">
          At least one grant type returned a full page of {GRANT_PAGE_SIZE} rows, so older grants may not be
          listed. Narrow by grant type to see the rest.
        </p>
      ) : null}

      <div className="filter-bar premium-card flex flex-wrap gap-2">
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All grant types</SelectItem>
            {(Object.keys(KIND_LABEL) as GrantKind[]).map((k) => (
              <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
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
          <CardDescription>Up to 200 most recent grants per type. Open the parent record to issue new tokens.</CardDescription>
        </CardHeader>
        <CardContent>
          {grantsQuery.isError ? (
            <QueryError what="guest access grants" error={grantsQuery.error} onRetry={() => grantsQuery.refetch()} />
          ) : grantsQuery.isLoading ? (
            <QueryLoading what="guest access grants" />
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No guest grants match these filters.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((grant) => {
                const active = isActive(grant);
                return (
                  <div key={`${grant.kind}-${grant.id}`} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{grant.label}</p>
                        <Badge variant="outline">{KIND_LABEL[grant.kind]}</Badge>
                        <Badge variant={active ? "default" : "secondary"}>{active ? "Active" : grant.revokedAt ? "Revoked" : "Expired"}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Issued {grant.createdAt ? formatDateForDisplay(grant.createdAt) : "—"}
                        {grant.expiresAt ? ` · Expires ${formatDateForDisplay(grant.expiresAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={grant.parentHref}><ExternalLink className="mr-1 h-3.5 w-3.5" />{grant.parentLabel}</Link>
                      </Button>
                      {canManage && active && (
                        <Button size="sm" variant="destructive" onClick={() => { setRevokeTarget(grant); setReason(""); }}>
                          <ShieldOff className="mr-1 h-3.5 w-3.5" /> Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
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
            <Label htmlFor={`${__fieldIds}-reason`}>Reason *</Label>
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
