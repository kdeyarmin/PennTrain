import { useState } from "react";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import {
  useAssignOrganizationCohort, useOrganizationCohortMemberships, useReleaseCohorts,
  useUnassignOrganizationCohort, type OrganizationCohortMembership,
} from "@/hooks/useReleaseFlagAdmin";

// The two sides do not agree, so neither does this. `assign_organization_release_cohort` records
// the reason without a length check; `unassign_organization_release_cohort` raises 'A meaningful
// unassign reason is required' below 8 characters. One shared minimum of 5 meant a 5-to-7 character
// removal reason passed the form and was refused by the server.
const MIN_ASSIGN_REASON = 5;
const MIN_UNASSIGN_REASON = 8;

/**
 * Which organizations are in which release cohort (BACKLOG.md G12.1, G15.1).
 *
 * `20260802030000_remove_pilot_program.sql` deleted the pilot cohort console and stated that "the
 * general release-flag / cohort / kill-switch mechanism itself is untouched". The mechanism did
 * survive; both of its entry points did not. The unassign side was dropped outright, and the assign
 * side kept its grant and lost its caller -- which nothing noticed, because the dormant-RPC gate was
 * reading multi-function grants a line at a time and every function after the first looked called.
 *
 * So an organization could be neither put into a cohort nor taken out of one, while the tables sat
 * there intact. This lives on the release-flags page, beside the flags and kill switches it belongs
 * with. It is deliberately not a re-creation of the pilot console: no pilot programme, no cohort
 * authoring, just membership of the cohorts that already exist.
 */
export function ReleaseCohortMembershipCard() {
  const { toast } = useToast();
  const cohorts = useReleaseCohorts();
  const memberships = useOrganizationCohortMemberships();
  const assign = useAssignOrganizationCohort();
  const unassign = useUnassignOrganizationCohort();

  const [organizationId, setOrganizationId] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [featureKey, setFeatureKey] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [removing, setRemoving] = useState<OrganizationCohortMembership | null>(null);
  const [removeReason, setRemoveReason] = useState("");

  const cohortName = (id: string) =>
    cohorts.data?.find((cohort) => cohort.id === id)?.name ?? id.slice(0, 8);

  const canAssign = organizationId.trim() && cohortId && featureKey.trim()
    && reason.trim().length >= MIN_ASSIGN_REASON;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-5 w-5" />Cohort membership
        </CardTitle>
        <CardDescription>
          Which organizations a feature is being released to, and on what terms. Both putting an
          organization into a cohort and taking it out again go through here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cohort-org">Organization</Label>
            <Input id="cohort-org" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} placeholder="Organization UUID" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cohort-pick">Cohort</Label>
            <Select value={cohortId} onValueChange={setCohortId}>
              <SelectTrigger id="cohort-pick"><SelectValue placeholder="Pick a cohort" /></SelectTrigger>
              <SelectContent>
                {(cohorts.data ?? []).map((cohort) => (
                  <SelectItem key={cohort.id} value={cohort.id} disabled={!cohort.is_active}>
                    {cohort.name}{cohort.is_active ? "" : " (inactive)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cohort-feature">Feature key</Label>
            <Input id="cohort-feature" value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} placeholder="resident_appointments" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cohort-expiry">Expires (optional)</Label>
            <Input id="cohort-expiry" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="cohort-reason">Reason</Label>
            <Input id="cohort-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Early access agreed with the operator for the appointments pilot." />
          </div>
        </div>
        <Button
          size="sm"
          disabled={assign.isPending || !canAssign}
          onClick={() => assign.mutate({
            organizationId: organizationId.trim(),
            cohortId,
            featureKey: featureKey.trim(),
            reason: reason.trim(),
            expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
          }, {
            onSuccess: () => { setReason(""); toast({ title: "Organization added to the cohort" }); },
            onError: (error) => toast({ title: "Assignment blocked", description: errorText(error), variant: "destructive" }),
          })}
        >
          {assign.isPending ? "Assigning…" : "Add to cohort"}
        </Button>

        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current membership</p>
          {(memberships.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No organization is in a release cohort.</p>
          )}
          {(memberships.data ?? []).map((membership) => (
            <div key={membership.id} className="space-y-1 rounded border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <span className="font-medium">{cohortName(membership.cohort_id)}</span>{" "}
                  <span className="font-mono text-xs text-muted-foreground">{membership.organization_id.slice(0, 8)}…</span>
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{membership.feature_key}</Badge>
                  {membership.expires_at && (
                    <Badge variant="outline">until {new Date(membership.expires_at).toLocaleDateString()}</Badge>
                  )}
                  {removing?.id !== membership.id && (
                    <Button size="sm" variant="ghost" onClick={() => { setRemoving(membership); setRemoveReason(""); }}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              {membership.reason && <p className="text-xs text-muted-foreground">{membership.reason}</p>}
              {removing?.id === membership.id && (
                <div className="space-y-2 pt-1">
                  <Input value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="Why they are coming out of the cohort" />
                  {removeReason.trim().length > 0 && removeReason.trim().length < MIN_UNASSIGN_REASON && (
                    <p className="text-xs text-muted-foreground">
                      At least {MIN_UNASSIGN_REASON} characters — the server requires it.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant="destructive"
                      disabled={unassign.isPending || removeReason.trim().length < MIN_UNASSIGN_REASON}
                      onClick={() => unassign.mutate({
                        organizationId: membership.organization_id,
                        cohortId: membership.cohort_id,
                        featureKey: membership.feature_key,
                        reason: removeReason.trim(),
                      }, {
                        onSuccess: () => { setRemoving(null); toast({ title: "Organization removed from the cohort" }); },
                        onError: (error) => toast({ title: "Removal blocked", description: errorText(error), variant: "destructive" }),
                      })}
                    >
                      Confirm removal
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
