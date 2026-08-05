/**
 * Standing enterprise access, with a way to end it (BACKLOG.md G10).
 *
 * The console could issue an effective-dated grant and never close one: `end_enterprise_role_grant`
 * had no caller anywhere. A grant with `effective_to is null` is live access to a portfolio, region,
 * organization or facility, so the console was a one-way door on privilege.
 *
 * The list shows open grants only. Closed ones are history and belong in the audit trail, not in a
 * screen whose purpose is deciding what access should still exist.
 */
import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { useEndEnterpriseRoleGrant, useStandingEnterpriseGrants } from "@/hooks/useEnterpriseAccessGrants";
import { endGrantIssues, grantAgeLabel } from "@/lib/enterpriseAccessGrants";
import { useToast } from "@/hooks/use-toast";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function StandingGrantsCard() {
  const grants = useStandingEnterpriseGrants();
  const endGrant = useEndEnterpriseRoleGrant();
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const rows = grants.data ?? [];
  const now = new Date();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Standing enterprise access</CardTitle>
        <CardDescription>
          Grants with no end date. Each one is live access to its scope until somebody closes it — ending a
          grant does not delete it, it records when the access stopped and why.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {grants.isError && (
          <QueryError what="standing grants" error={grants.error} onRetry={() => void grants.refetch()} />
        )}
        {grants.isLoading && <p className="text-sm text-muted-foreground">Loading grants…</p>}
        {!grants.isLoading && !grants.isError && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No open enterprise grants.</p>
        )}

        {rows.map((grant) => {
          const open = openId === grant.id;
          const issues = open
            ? endGrantIssues({
                reason,
                effectiveTo: now.toISOString(),
                effectiveFrom: grant.effectiveFrom,
              })
            : [];
          return (
            <div key={grant.id} className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{grant.holderName} · {grant.roleTemplateName}</p>
                  <p className="text-xs text-muted-foreground">
                    {grant.scopeType} scope · {grantAgeLabel(grant.effectiveFrom, now)} · via {grant.source}
                  </p>
                  {grant.reason && <p className="mt-1 text-xs text-muted-foreground">Granted: {grant.reason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Open</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setOpenId(open ? null : grant.id); setReason(""); }}
                  >
                    {open ? "Cancel" : "End grant"}
                  </Button>
                </div>
              </div>

              {open && (
                <div className="space-y-2">
                  <Label htmlFor={`grant-reason-${grant.id}`} className="text-xs">Why the access is ending</Label>
                  <Textarea
                    id={`grant-reason-${grant.id}`}
                    rows={2}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Transferred out of the region on 1 August"
                  />
                  {issues.map((issue) => (
                    <p key={issue} className="text-xs text-muted-foreground">{issue}</p>
                  ))}
                  <Button
                    size="sm"
                    disabled={issues.length > 0 || endGrant.isPending}
                    onClick={async () => {
                      try {
                        await endGrant.mutateAsync({ grantId: grant.id, reason });
                        toast({ title: "Grant ended", description: `${grant.holderName} no longer holds ${grant.roleTemplateName}.` });
                        setOpenId(null);
                        setReason("");
                      } catch (error) {
                        toast({
                          title: "Ending the grant was blocked",
                          description: error instanceof Error ? error.message : String(error),
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    {endGrant.isPending
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <KeyRound className="mr-2 h-4 w-4" />}
                    End this grant
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
