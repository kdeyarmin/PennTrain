import { useState } from "react";
import { GitCompare, History } from "lucide-react";
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
import { signatureDigest } from "@/lib/certificationAttempt";
import {
  SHADOW_RATIONALE_MIN, SHADOW_RESOLUTIONS, useReconcileShadowDifference,
  useRegulatoryRuleSnapshot, useShadowDifferences,
} from "@/hooks/useRegulatoryGovernance";

/**
 * What a rule said on a date, and what a shadow run disagreed about
 * (BACKLOG.md G15.17, G15.19).
 *
 * A shadow run evaluates a candidate rule version against a cohort alongside the current one and
 * records every case where they differ. That is how a regulation change is tested before it binds.
 * Nothing could read the differences or resolve one, so the mechanism ran into a table nobody could
 * act on -- and `get_regulatory_rule_snapshot`, which answers "what did this rule say on the day
 * this happened", had no caller either, though that is the question every retrospective compliance
 * argument turns on.
 *
 * Two siblings are deliberately not here. `record_regulatory_shadow_run` and
 * `record_regulatory_fixture_result` take an engine version, an evaluated count and a request id --
 * machine output from a rule engine or a conformance harness, not something a person types. Giving
 * them a form would be inventing a user for them.
 */
export function RegulatoryGovernanceCard() {
  const { toast } = useToast();
  const [ruleKey, setRuleKey] = useState("");
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [lookedUp, setLookedUp] = useState(false);
  const snapshot = useRegulatoryRuleSnapshot(ruleKey.trim(), asOf, lookedUp);

  const differences = useShadowDifferences();
  const reconcile = useReconcileShadowDifference();
  const [openDifference, setOpenDifference] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string>("expected_change");
  const [rationale, setRationale] = useState("");

  const submit = async (differenceId: string, checksum: string) => {
    // The reconciliation's own evidence checksum, derived from what the reviewer decided and wrote.
    // The constraint demands 64 hex characters; this is the same convention `signatureDigest` sets.
    const evidence = await signatureDigest(`${differenceId}|${resolution}|${rationale.trim()}|${checksum}`);
    reconcile.mutate(
      { differenceId, resolution, rationale: rationale.trim(), evidenceChecksumSha256: evidence },
      {
        onSuccess: () => { setOpenDifference(null); setRationale(""); toast({ title: "Difference reconciled" }); },
        onError: (error) => toast({ title: "Reconciliation refused", description: errorText(error), variant: "destructive" }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-5 w-5" />Rule history and shadow differences
        </CardTitle>
        <CardDescription>
          What a rule said on a given date, and the cases where a candidate rule version disagreed
          with the current one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            What did this rule say on
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="rule-key">Rule key</Label>
              <Input id="rule-key" className="sm:w-64" value={ruleKey} onChange={(e) => { setRuleKey(e.target.value); setLookedUp(false); }} placeholder="pch_staffing_ratio" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-as-of">As of</Label>
              <Input id="rule-as-of" type="date" className="sm:w-48" value={asOf} onChange={(e) => { setAsOf(e.target.value); setLookedUp(false); }} />
            </div>
            <Button size="sm" variant="outline" disabled={!ruleKey.trim() || !asOf} onClick={() => setLookedUp(true)}>
              Look up
            </Button>
          </div>

          {lookedUp && snapshot.isLoading && <p className="text-sm text-muted-foreground">Looking…</p>}
          {lookedUp && snapshot.isError && (
            <p className="text-sm text-destructive">{errorText(snapshot.error)}</p>
          )}
          {lookedUp && snapshot.isSuccess && !snapshot.data && (
            <p className="text-sm text-muted-foreground">
              No version of that rule was in effect on {asOf}. That is an answer, not a failure —
              either the key is wrong or the rule did not exist yet.
            </p>
          )}
          {snapshot.data && (
            <div className="space-y-1 rounded border p-2 text-sm">
              <p className="font-medium">
                {snapshot.data.citation} <span className="text-muted-foreground">v{snapshot.data.version_number}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {snapshot.data.authority_name} · {snapshot.data.jurisdiction_code}
              </p>
              {snapshot.data.source_uri && (
                <a className="text-xs text-primary hover:underline" href={snapshot.data.source_uri} target="_blank" rel="noreferrer">
                  Source document
                </a>
              )}
              {snapshot.data.source_checksum_sha256 && (
                <p className="font-mono text-xs text-muted-foreground">
                  {snapshot.data.source_checksum_sha256.slice(0, 16)}…
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <GitCompare className="h-3.5 w-3.5" />Shadow differences
          </p>
          {(differences.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              No shadow run has recorded a difference. Runs are recorded by the rule engine, not from
              here.
            </p>
          )}
          {(differences.data ?? []).map((difference) => (
            <div key={difference.id} className="space-y-2 rounded border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{difference.subject_reference}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{new Date(difference.created_at).toLocaleDateString()}</Badge>
                  {openDifference !== difference.id && (
                    <Button size="sm" variant="outline" onClick={() => { setOpenDifference(difference.id); setResolution("expected_change"); setRationale(""); }}>
                      Reconcile
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded bg-muted/40 p-2">
                  <p className="text-xs font-medium">Current rule</p>
                  <pre className="overflow-x-auto text-xs">{JSON.stringify(difference.baseline_result, null, 2)}</pre>
                </div>
                <div className="rounded bg-muted/40 p-2">
                  <p className="text-xs font-medium">Candidate rule</p>
                  <pre className="overflow-x-auto text-xs">{JSON.stringify(difference.candidate_result, null, 2)}</pre>
                </div>
              </div>

              {openDifference === difference.id && (
                <div className="space-y-2 rounded bg-muted/40 p-2">
                  <div className="space-y-1">
                    <Label htmlFor={`res-${difference.id}`}>Resolution</Label>
                    <Select value={resolution} onValueChange={setResolution}>
                      <SelectTrigger id={`res-${difference.id}`} className="sm:w-80"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SHADOW_RESOLUTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`rat-${difference.id}`}>Rationale</Label>
                    <Textarea id={`rat-${difference.id}`} rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} />
                    {rationale.trim().length < SHADOW_RATIONALE_MIN && (
                      <p className="text-xs text-muted-foreground">
                        At least {SHADOW_RATIONALE_MIN} characters — the server's own constraint.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={reconcile.isPending || rationale.trim().length < SHADOW_RATIONALE_MIN}
                      onClick={() => void submit(difference.id, difference.difference_checksum_sha256)}
                    >
                      {reconcile.isPending ? "Recording…" : "Record resolution"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpenDifference(null)}>Cancel</Button>
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
