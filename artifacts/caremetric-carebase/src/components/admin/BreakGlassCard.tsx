import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import { QueryError } from "@/components/QueryState";
import { useAuth } from "@/lib/auth";
import { facilityDateTimeLocalToUtcIso, toFacilityDateTimeLocal } from "@/lib/dateUtils";
import {
  isBreakGlassActive, useBreakGlassEvents, useGrantBreakGlass, useRevokeBreakGlass,
} from "@/hooks/useBreakGlass";

const MIN_REASON = 10;
/** Break-glass is measured in hours. A day is already a long emergency. */
const MAX_HOURS = 24;

function defaultExpiry(): string {
  return toFacilityDateTimeLocal(new Date(Date.now() + 4 * 60 * 60 * 1000));
}

/**
 * Emergency elevated access (BACKLOG.md G15.9, G15.10).
 *
 * Both halves of this shipped complete and unreachable: `grant_identity_break_glass`, with its
 * requester, reason, ticket reference and mandatory expiry, and `revoke_identity_break_glass` to
 * end one early. So emergency access could not be granted -- and, more to the point, a grant could
 * never have been ended before its own expiry.
 *
 * The form asks for a ticket reference because break-glass is the access you justify afterwards,
 * and "there was an incident" is not a justification anyone can audit.
 *
 * It asks who requested the access separately from who is approving it because the server insists
 * on two people: `grant_identity_break_glass` raises 'break-glass requests require a separate
 * approver' when `p_requested_by` is the caller. The first version of this form filled the
 * requester in with the signed-in admin, so every grant it submitted was rejected -- the one path
 * that has to work at 3am failed on its own precondition.
 */
export function BreakGlassCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const events = useBreakGlassEvents();
  const grant = useGrantBreakGlass();
  const revoke = useRevokeBreakGlass();

  const [opening, setOpening] = useState(false);
  const [targetProfileId, setTargetProfileId] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const expiry = (() => {
    if (!expiresAt) return null;
    try {
      return new Date(facilityDateTimeLocalToUtcIso(expiresAt));
    } catch {
      return null;
    }
  })();
  // Both range checks are `!!expiry && ...`, so CLEARING the field made them both false and left
  // canGrant true -- and the grant handler then calls `facilityDateTimeLocalToUtcIso("")`, which throws
  // RangeError out of an onClick. An unparseable value does the same by a different route: every
  // comparison against NaN is false. A usable expiry has to be its own condition, not the absence
  // of a violated one.
  const expiryUsable = !!expiry && !Number.isNaN(expiry.getTime());
  const expiryPast = expiryUsable && expiry!.getTime() <= Date.now();
  const expiryTooFar = expiryUsable && expiry!.getTime() > Date.now() + MAX_HOURS * 3_600_000;
  // Checked here as well as on the server so the refusal arrives while the field can still be
  // corrected, rather than as a failed submission with the reason buried in an error toast.
  const approverIsRequester = requestedBy.trim().length > 0 && requestedBy.trim() === user?.id;
  const canGrant = targetProfileId.trim().length > 0
    && requestedBy.trim().length > 0 && !approverIsRequester
    && reason.trim().length >= MIN_REASON
    && ticket.trim().length > 0
    && expiryUsable && !expiryPast && !expiryTooFar;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />Break-glass access
        </CardTitle>
        <CardDescription>
          Time-boxed elevated access for an incident, with the reason and ticket recorded at the
          moment it is granted — and revocable before its expiry, which is the half that matters
          when an investigation moves faster than the clock.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!opening && (
          <Button variant="outline" size="sm" onClick={() => {
            setOpening(true); setTargetProfileId(""); setRequestedBy(""); setReason(""); setTicket(""); setExpiresAt(defaultExpiry());
          }}>
            Grant break-glass access
          </Button>
        )}

        {opening && (
          <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="bg-target">Profile receiving access</Label>
              <Input id="bg-target" value={targetProfileId} onChange={(e) => setTargetProfileId(e.target.value)} placeholder="Profile UUID" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bg-requester">Requested by</Label>
              <Input id="bg-requester" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="Profile UUID of whoever asked for it" />
              {approverIsRequester ? (
                <p className="text-xs text-destructive">
                  You are approving this, so you cannot also be the one who requested it. Break-glass
                  takes two people.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Someone other than you, in the same organization as the profile above. You are
                  recorded as the approver.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bg-ticket">Ticket reference</Label>
              <Input id="bg-ticket" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="INC-2043" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bg-reason">Why this access is needed now</Label>
              <Textarea id="bg-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              {reason.trim().length < MIN_REASON && (
                <p className="text-xs text-muted-foreground">At least {MIN_REASON} characters.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bg-expiry">Expires</Label>
              <Input id="bg-expiry" type="datetime-local" className="sm:w-64" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              {expiryPast && <p className="text-xs text-destructive">It has to expire in the future.</p>}
              {expiryTooFar && (
                <p className="text-xs text-destructive">
                  {MAX_HOURS} hours is the maximum here. Longer than that is not an emergency, it is a role.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm" variant="destructive"
                disabled={grant.isPending || !canGrant || !user?.id}
                onClick={() => grant.mutate({
                  targetProfileId: targetProfileId.trim(),
                  requestedBy: requestedBy.trim(),
                  reason: reason.trim(),
                  ticketReference: ticket.trim(),
                  expiresAt: facilityDateTimeLocalToUtcIso(expiresAt),
                }, {
                  onSuccess: () => { setOpening(false); toast({ title: "Break-glass access granted", description: "It ends at the expiry you set, or when you revoke it." }); },
                  onError: (error) => toast({ title: "Grant blocked", description: errorText(error), variant: "destructive" }),
                })}
              >
                {grant.isPending ? "Granting…" : "Grant"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpening(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {events.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading break-glass access…</p>
          ) : events.isError ? (
            <QueryError what="break-glass access" error={events.error} onRetry={() => void events.refetch()} />
          ) : (events.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No break-glass access has been granted.</p>
          ) : null}
          {!events.isLoading && !events.isError && (events.data ?? []).map((event) => {
            const active = isBreakGlassActive(event);
            return (
              <div key={event.id} className="space-y-1 rounded border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs">{event.target_profile_id.slice(0, 8)}…</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={active ? "destructive" : "outline"}>
                      {active ? "active" : event.revoked_at ? "revoked" : "expired"}
                    </Badge>
                    {active && revoking !== event.id && (
                      <Button size="sm" variant="outline" onClick={() => { setRevoking(event.id); setRevokeReason(""); }}>
                        Revoke now
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {event.ticket_reference ? `${event.ticket_reference} · ` : ""}
                  granted {new Date(event.granted_at).toLocaleString()} · expires {new Date(event.expires_at).toLocaleString()}
                </p>
                <p className="text-xs">{event.reason}</p>
                {event.revocation_reason && (
                  <p className="text-xs text-muted-foreground">Revoked: {event.revocation_reason}</p>
                )}
                {revoking === event.id && (
                  <div className="space-y-2 pt-1">
                    <Input
                      value={revokeReason}
                      onChange={(e) => setRevokeReason(e.target.value)}
                      placeholder="Why it is being ended early"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm" variant="destructive"
                        disabled={revoke.isPending || revokeReason.trim().length < MIN_REASON}
                        onClick={() => revoke.mutate({ eventId: event.id, reason: revokeReason.trim() }, {
                          onSuccess: () => { setRevoking(null); toast({ title: "Break-glass access revoked" }); },
                          onError: (error) => toast({ title: "Revoke blocked", description: errorText(error), variant: "destructive" }),
                        })}
                      >
                        Confirm revoke
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRevoking(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
