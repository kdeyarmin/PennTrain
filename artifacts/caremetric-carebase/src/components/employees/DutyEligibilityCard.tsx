import { useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import {
  canRequestOverride, dutyEligibilitySummary, dutyReasons, isDutyBlocked,
} from "@/lib/dutyEligibility";
import {
  DUTY_KEYS, useDutyEligibility, useDutyEligibilityOverrides, useGrantDutyEligibilityOverride,
  type DutyKey,
} from "@/hooks/useDutyEligibility";

/** Server rule: an override may not run longer than a year. Mirrored so the form says so first. */
const MAX_OVERRIDE_DAYS = 365;
const MIN_REASON_LENGTH = 10;

function defaultExpiry(): string {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  return date.toISOString().slice(0, 10);
}

/**
 * Whether this person may carry out a regulated duty, and the supervisor's written override
 * (BACKLOG.md G12.4).
 *
 * `grant_duty_eligibility_override` shipped with careful rules -- org_admin only, never to
 * yourself, a written reason, a mandatory future expiry capped at a year -- and no caller, so a
 * person blocked by a rule could only be unblocked by changing the underlying record. That is the
 * right answer for a missing credential and the wrong one for a judgement the rule cannot see, and
 * `dutyEligibility.ts` had said so all along by marking each reason `overridable` or not.
 *
 * The override is offered only where the library says it is a sensible response. A block for
 * "this person has no account" is not something to wave through, and the button does not appear.
 */
export function DutyEligibilityCard({
  profileId,
  facilityId,
  employeeName,
  canOverride,
}: {
  profileId: string | null;
  facilityId: string | null;
  employeeName: string;
  /** Only an org admin may grant one; the server enforces it, this keeps the form honest. */
  canOverride: boolean;
}) {
  const { toast } = useToast();
  const [dutyKey, setDutyKey] = useState<DutyKey>("resident_assessor");
  const [granting, setGranting] = useState(false);
  const [reason, setReason] = useState("");
  const [expiresOn, setExpiresOn] = useState(defaultExpiry());

  const eligibility = useDutyEligibility(profileId, dutyKey, facilityId);
  const overrides = useDutyEligibilityOverrides(profileId);
  const grant = useGrantDutyEligibilityOverride();

  if (!profileId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldQuestion className="h-5 w-5" />Duty eligibility
          </CardTitle>
          <CardDescription>
            {employeeName} has no portal account, so there is nothing to evaluate: the rules are
            about who signs, and signing requires an account.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const result = eligibility.data;
  const blocked = isDutyBlocked(result);
  const summary = dutyEligibilitySummary(result);
  const overridable = canRequestOverride(result);
  const reasonTooShort = reason.trim().length < MIN_REASON_LENGTH;
  const expiryDate = expiresOn ? new Date(`${expiresOn}T23:59:59`) : null;
  const expiryTooFar = !!expiryDate
    && expiryDate.getTime() > Date.now() + MAX_OVERRIDE_DAYS * 86_400_000;
  const expiryPast = !!expiryDate && expiryDate.getTime() <= Date.now();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {blocked ? <ShieldAlert className="h-5 w-5 text-destructive" /> : <ShieldCheck className="h-5 w-5 text-emerald-600" />}
          Duty eligibility
        </CardTitle>
        <CardDescription>
          Whether {employeeName} may carry out a regulated duty, evaluated by the same function the
          server uses to refuse the action.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="duty-key">Duty</Label>
          <Select value={dutyKey} onValueChange={(value) => setDutyKey(value as DutyKey)}>
            <SelectTrigger id="duty-key" className="sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DUTY_KEYS.map((duty) => (
                <SelectItem key={duty.key} value={duty.key}>{duty.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {eligibility.isLoading && <p className="text-sm text-muted-foreground">Evaluating…</p>}
        {eligibility.isError && (
          <p className="text-sm text-destructive">
            Could not evaluate: {errorText(eligibility.error)}
          </p>
        )}

        {result && (
          <div className="space-y-2 rounded-md border p-3">
            <Badge variant={blocked ? "destructive" : result.outcome === "warning" ? "outline" : "secondary"}>
              {result.outcome}
            </Badge>
            {summary && <p className="text-sm">{summary}</p>}
            {dutyReasons(result).map((entry) => (
              <div key={entry.code} className="text-xs text-muted-foreground">
                <span className="font-medium">{entry.summary}</span> {entry.resolution}
                {!entry.overridable && " (an override cannot substitute for this)"}
              </div>
            ))}
            {result.overrideId && (
              <p className="text-xs text-muted-foreground">
                Currently carried by an active override.
              </p>
            )}
          </div>
        )}

        {overridable && canOverride && !granting && (
          <Button variant="outline" size="sm" onClick={() => { setGranting(true); setReason(""); setExpiresOn(defaultExpiry()); }}>
            Grant a written override
          </Button>
        )}
        {overridable && !canOverride && (
          <p className="text-xs text-muted-foreground">
            An organization administrator can grant a written override for this.
          </p>
        )}

        {granting && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="override-reason">Why this person may carry out the duty anyway</Label>
              <Textarea
                id="override-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Held the equivalent credential at a prior employer; verified with the licensing board on 3 August."
              />
              {reasonTooShort && (
                <p className="text-xs text-muted-foreground">
                  At least {MIN_REASON_LENGTH} characters. This is the record a surveyor reads.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="override-expiry">Expires</Label>
              <Input
                id="override-expiry"
                type="date"
                className="sm:w-56"
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
              />
              {expiryPast && <p className="text-xs text-destructive">An override has to expire in the future.</p>}
              {expiryTooFar && (
                <p className="text-xs text-destructive">
                  A year is the maximum. An exemption that outlives the reason for it is not an exemption.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={grant.isPending || reasonTooShort || expiryPast || expiryTooFar || !facilityId}
                onClick={() => {
                  if (!facilityId) return;
                  grant.mutate(
                    {
                      profileId,
                      dutyKey,
                      facilityId,
                      reason: reason.trim(),
                      expiresAt: new Date(`${expiresOn}T23:59:59`).toISOString(),
                    },
                    {
                      onSuccess: () => {
                        setGranting(false);
                        setReason("");
                        toast({ title: "Override granted", description: "It expires on the date you set." });
                      },
                      onError: (error) => toast({
                        title: "Could not grant the override",
                        description: errorText(error),
                        variant: "destructive",
                      }),
                    },
                  );
                }}
              >
                {grant.isPending ? "Granting…" : "Grant override"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setGranting(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {(overrides.data ?? []).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Overrides on record
            </p>
            <ul className="space-y-1">
              {(overrides.data ?? []).map((row) => {
                const expired = new Date(row.expires_at).getTime() <= Date.now();
                return (
                  <li key={row.id} className="rounded border px-2 py-1 text-xs">
                    <span className="font-medium">{row.duty_key.replace(/_/g, " ")}</span>
                    {" · "}
                    {expired ? "expired" : "expires"} {new Date(row.expires_at).toLocaleDateString()}
                    <span className="block text-muted-foreground">{row.reason}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
