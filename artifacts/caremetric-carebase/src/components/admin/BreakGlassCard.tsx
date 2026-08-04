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
import { useAuth } from "@/lib/auth";
import {
  isBreakGlassActive, useBreakGlassEvents, useGrantBreakGlass, useRevokeBreakGlass,
} from "@/hooks/useBreakGlass";

const MIN_REASON = 10;
/** Break-glass is measured in hours. A day is already a long emergency. */
const MAX_HOURS = 24;

function defaultExpiry(): string {
  const when = new Date(Date.now() + 4 * 60 * 60 * 1000);
  // datetime-local wants local time without a zone suffix.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
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
 */
export function BreakGlassCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const events = useBreakGlassEvents();
  const grant = useGrantBreakGlass();
  const revoke = useRevokeBreakGlass();

  const [opening, setOpening] = useState(false);
  const [targetProfileId, setTargetProfileId] = useState("");
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const expiry = expiresAt ? new Date(expiresAt) : null;
  const expiryPast = !!expiry && expiry.getTime() <= Date.now();
  const expiryTooFar = !!expiry && expiry.getTime() > Date.now() + MAX_HOURS * 3_600_000;
  const canGrant = targetProfileId.trim().length > 0
    && reason.trim().length >= MIN_REASON
    && ticket.trim().length > 0
    && !expiryPast && !expiryTooFar;

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
            setOpening(true); setTargetProfileId(""); setReason(""); setTicket(""); setExpiresAt(defaultExpiry());
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
                  requestedBy: user!.id,
                  reason: reason.trim(),
                  ticketReference: ticket.trim(),
                  expiresAt: new Date(expiresAt).toISOString(),
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
          {(events.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No break-glass access has been granted.</p>
          )}
          {(events.data ?? []).map((event) => {
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
