import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Mail,
  MailPlus,
  RefreshCw,
  Search,
  ShieldOff,
  Upload,
  Users,
} from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  useBulkInviteUsers,
  useInvitationLifecycle,
  useResendInvitation,
  useRevokeInvitation,
  type UserInvitation,
} from "@/hooks/useInvitationLifecycle";
import {
  INVITATION_ROLES,
  INVITATION_STATUSES,
  bulkInviteTemplate,
  canResendInvitation,
  canRevokeInvitation,
  invitationRoleLabel,
  invitationStatusLabel,
  parseBulkInviteCsv,
} from "@/lib/invitationLifecycle";
import { downloadCsv } from "@/lib/dataImportCenter";
import { absoluteAppUrl } from "@/lib/appUrl";

const PAGE_SIZE = 25;

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "accepted") return "default";
  if (status === "revoked" || status === "delivery_failed") return "destructive";
  if (status === "expired") return "outline";
  return "secondary";
}

export default function InvitationLifecycle() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<UserInvitation | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkResults, setBulkResults] = useState<Array<{ email: string; success: boolean; error?: string }> | null>(null);

  const filters = useMemo(
    () => ({ status, role, search, page, pageSize: PAGE_SIZE }),
    [status, role, search, page],
  );
  const invitations = useInvitationLifecycle(filters);
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const bulkInvite = useBulkInviteUsers();

  const total = invitations.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canManage = user?.role === "org_admin" || user?.role === "facility_manager" || user?.role === "platform_admin";

  const onResend = async (invitation: UserInvitation) => {
    try {
      await resend.mutateAsync(invitation.id);
      toast({ title: "Invitation resent", description: `A fresh invite was sent to ${invitation.email}.` });
    } catch (error) {
      toast({
        title: "Resend failed",
        description: error instanceof Error ? error.message : "Unable to resend invitation",
        variant: "destructive",
      });
    }
  };

  const onRevoke = async () => {
    if (!revokeTarget || revokeReason.trim().length < 3) return;
    try {
      await revoke.mutateAsync({ invitationId: revokeTarget.id, reason: revokeReason.trim() });
      toast({ title: "Invitation revoked", description: revokeTarget.email });
      setRevokeTarget(null);
      setRevokeReason("");
    } catch (error) {
      toast({
        title: "Revoke failed",
        description: error instanceof Error ? error.message : "Unable to revoke invitation",
        variant: "destructive",
      });
    }
  };

  const onBulkInvite = async () => {
    const parsed = parseBulkInviteCsv(bulkCsv);
    if (parsed.errors.length && parsed.rows.length === 0) {
      toast({ title: "Bulk invite CSV is invalid", description: parsed.errors[0], variant: "destructive" });
      return;
    }
    if (parsed.rows.length === 0) {
      toast({ title: "No invite rows found", variant: "destructive" });
      return;
    }
    try {
      const results = await bulkInvite.mutateAsync({
        rows: parsed.rows,
        organizationId: user?.organizationId ?? null,
        redirectTo: absoluteAppUrl("/reset-password"),
      });
      setBulkResults(results);
      const succeeded = results.filter((row) => row.success).length;
      toast({
        title: "Bulk invite finished",
        description: `${succeeded} sent · ${results.length - succeeded} failed${parsed.errors.length ? ` · ${parsed.errors.length} CSV row(s) skipped` : ""}`,
      });
    } catch (error) {
      toast({
        title: "Bulk invite failed",
        description: error instanceof Error ? error.message : "Unable to process bulk invites",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Access provisioning</p>
          <h1 className="text-2xl font-bold tracking-tight">Invitation lifecycle</h1>
          <p className="max-w-3xl text-muted-foreground">
            Track every portal invite from send through acceptance, expiry, delivery failure, or revocation.
            Repair pending invitations without losing the durable receipt that links email, role, and employee.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/app/users"><Users className="mr-2 h-4 w-4" /> User directory</Link>
          </Button>
          {canManage && (
            <Button onClick={() => { setBulkCsv(""); setBulkResults(null); setBulkOpen(true); }}>
              <MailPlus className="mr-2 h-4 w-4" /> Bulk invite
            </Button>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Paginated organization-scoped invitation receipts with status and role filters.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search email or name"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(0); }}
            />
          </div>
          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(0); }}>
            <SelectTrigger aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {INVITATION_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>{invitationStatusLabel(value)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={(value) => { setRole(value); setPage(0); }}>
            <SelectTrigger aria-label="Role"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {INVITATION_ROLES.map((value) => (
                <SelectItem key={value} value={value}>{invitationRoleLabel(value)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => invitations.refetch()} disabled={invitations.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${invitations.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitation receipts</CardTitle>
          <CardDescription>
            {total} invitation{total === 1 ? "" : "s"} match the current filters.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {invitations.isLoading ? (
            <QueryLoading what="invitations" />
          ) : invitations.isError ? (
            <QueryError what="invitations" error={invitations.error} onRetry={() => invitations.refetch()} />
          ) : invitations.data?.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No invitation receipts yet. Send portal invites from Users or Employees, or use bulk invite.
            </p>
          ) : (
            invitations.data?.rows.map((invitation) => (
              <div key={invitation.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {invitation.first_name} {invitation.last_name}
                      </p>
                      <Badge variant={statusVariant(invitation.status)}>
                        {invitationStatusLabel(invitation.status)}
                      </Badge>
                      <Badge variant="outline">{invitationRoleLabel(invitation.invited_role)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Sent {new Date(invitation.sent_at).toLocaleString()} · last activity{" "}
                      {new Date(invitation.last_sent_at).toLocaleString()} · expires{" "}
                      {new Date(invitation.expires_at).toLocaleString()} · send count {invitation.send_count}
                    </p>
                    {invitation.last_error && (
                      <p className="text-xs text-destructive">{invitation.last_error}</p>
                    )}
                    {invitation.employee_id && (
                      <Button asChild size="sm" variant="link" className="h-auto px-0">
                        <Link href={`/app/employees/${invitation.employee_id}`}>Linked employee record</Link>
                      </Button>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canResendInvitation(invitation.status) || resend.isPending}
                        onClick={() => void onResend(invitation)}
                      >
                        <Mail className="mr-2 h-4 w-4" /> Resend
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!canRevokeInvitation(invitation.status) || revoke.isPending}
                        onClick={() => { setRevokeTarget(invitation); setRevokeReason(""); }}
                      >
                        <ShieldOff className="mr-2 h-4 w-4" /> Revoke
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Page {page + 1} of {pageCount}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((value) => value + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(revokeTarget)} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke invitation</DialogTitle>
            <DialogDescription>
              {revokeTarget
                ? `Revoke the pending invite for ${revokeTarget.email}. The durable receipt remains for audit.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">Reason</Label>
            <Textarea
              id="revoke-reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              placeholder="Why this invitation should no longer be usable"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={revokeReason.trim().length < 3 || revoke.isPending}
              onClick={() => void onRevoke()}
            >
              Revoke invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={(open) => { setBulkOpen(open); if (!open) { setBulkCsv(""); setBulkResults(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk invite</DialogTitle>
            <DialogDescription>
              Upload or paste the canonical invite CSV. Each row uses the same authorization matrix as a single invite.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadCsv("bulk-invite-template.csv", bulkInviteTemplate())}
              >
                <Download className="mr-2 h-4 w-4" /> Template
              </Button>
              <Label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <Upload className="h-4 w-4" />
                <span>Upload CSV</span>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setBulkCsv(await file.text());
                    setBulkResults(null);
                  }}
                />
              </Label>
            </div>
            <Textarea
              className="min-h-40 font-mono text-xs"
              value={bulkCsv}
              onChange={(event) => { setBulkCsv(event.target.value); setBulkResults(null); }}
              placeholder="email,first_name,last_name,role,employee_id"
            />
            {bulkResults && (
              <div className="max-h-40 space-y-1 overflow-auto rounded border p-3 text-sm">
                {bulkResults.map((result) => (
                  <p key={result.email} className={result.success ? "text-muted-foreground" : "text-destructive"}>
                    {result.email}: {result.success ? "sent" : result.error}
                  </p>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Close</Button>
            <Button disabled={!bulkCsv.trim() || bulkInvite.isPending} onClick={() => void onBulkInvite()}>
              {bulkInvite.isPending ? "Sending…" : "Send invites"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
