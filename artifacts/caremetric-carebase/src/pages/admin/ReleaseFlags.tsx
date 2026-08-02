import { useId, useMemo, useState } from "react";
import {
  useFeatureDefinitions,
  useFeatureKillSwitches,
  useReleaseFlags,
  useSetFeatureKillSwitch,
  useSetReleaseFlag,
} from "@/hooks/useReleaseFlagAdmin";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Flag, ShieldAlert } from "lucide-react";

function flagBadge(mode: string, enabled: boolean) {
  if (!enabled || mode === "off") return <Badge variant="outline">off</Badge>;
  if (mode === "global") return <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">global</Badge>;
  return <Badge className="bg-blue-100 text-blue-900 hover:bg-blue-100">{mode}</Badge>;
}

export default function ReleaseFlags() {
  const __fieldIds = useId();
  const { toast } = useToast();
  const flagsQ = useReleaseFlags();
  const defsQ = useFeatureDefinitions();
  const killsQ = useFeatureKillSwitches();

  const setFlag = useSetReleaseFlag();
  const setKill = useSetFeatureKillSwitch();

  const [flagReason, setFlagReason] = useState("Operator release change");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const defByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of defsQ.data ?? []) map.set(d.feature_key, d.display_name ?? d.feature_key);
    return map;
  }, [defsQ.data]);

  const killSet = useMemo(() => {
    const set = new Set<string>();
    for (const k of killsQ.data ?? []) {
      if (k.is_disabled && !k.organization_id) set.add(k.feature_key);
    }
    return set;
  }, [killsQ.data]);

  const anyError = flagsQ.isError || defsQ.isError;
  const firstError = (flagsQ.error as Error | null) ?? (defsQ.error as Error | null);

  const handleSetFlag = async (featureKey: string, mode: "global" | "off") => {
    if (flagReason.trim().length < 8) {
      toast({ title: "Reason required", description: "Use at least 8 characters before changing flags.", variant: "destructive" });
      return;
    }
    try {
      setBusyKey(`flag:${featureKey}:${mode}`);
      await setFlag.mutateAsync({
        featureKey,
        rolloutMode: mode,
        isEnabled: mode !== "off",
        owner: featureKey.split(".")[0] || "platform",
        reason: flagReason.trim(),
      });
      toast({ title: "Release flag updated", description: `${featureKey} → ${mode}` });
    } catch (e) {
      toast({
        title: "Flag update failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleKill = async (featureKey: string, disable: boolean) => {
    const reason = window.prompt(
      disable ? "Kill-switch reason (min 8 characters)" : "Clear kill-switch reason (min 8 characters)",
      disable ? "Emergency disable" : "Clear kill switch",
    );
    if (!reason || reason.trim().length < 8) return;
    try {
      setBusyKey(`kill:${featureKey}`);
      await setKill.mutateAsync({
        featureKey,
        isDisabled: disable,
        reason: reason.trim(),
      });
      toast({ title: disable ? "Kill switch on" : "Kill switch cleared", description: featureKey });
    } catch (e) {
      toast({
        title: "Kill switch failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Flag className="h-6 w-6" /> Release flags
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Every feature releases globally by default. Use this console only for an emergency kill switch, or to
          hold a feature off platform-wide. Writes require platform admin + MFA step-up (AAL2).
        </p>
      </div>

      {anyError ? (
        <QueryError
          what="release flag data"
          error={firstError as Error}
          onRetry={() => {
            void flagsQ.refetch();
            void defsQ.refetch();
          }}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Flag className="h-4 w-4" /> Flags</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{flagsQ.data?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground">Registered feature release flags</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Kill switches</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{killsQ.data?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground">Active feature disables</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Release flags</CardTitle>
          <CardDescription>
            Global releases the feature to every organization. Off disables it for everyone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xl space-y-1.5">
            <Label htmlFor={`${__fieldIds}-change-reason-required-for-flag-writes`}>Change reason (required for flag writes)</Label>
            <Input id={`${__fieldIds}-change-reason-required-for-flag-writes`} value={flagReason} onChange={(e) => setFlagReason(e.target.value)} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(flagsQ.data ?? []).map((flag) => (
                <TableRow key={flag.feature_key}>
                  <TableCell>
                    <p className="font-medium text-sm">{defByKey.get(flag.feature_key) ?? flag.feature_key}</p>
                    <p className="text-xs text-muted-foreground font-mono">{flag.feature_key}</p>
                  </TableCell>
                  <TableCell>{flagBadge(flag.rollout_mode, flag.is_enabled)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{flag.owner}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="outline" disabled={!!busyKey} onClick={() => void handleSetFlag(flag.feature_key, "global")}>
                      Global
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!!busyKey} onClick={() => void handleSetFlag(flag.feature_key, "off")}>
                      Off
                    </Button>
                    <Button
                      size="sm"
                      variant={killSet.has(flag.feature_key) ? "default" : "destructive"}
                      disabled={!!busyKey}
                      onClick={() => void handleKill(flag.feature_key, !killSet.has(flag.feature_key))}
                    >
                      {killSet.has(flag.feature_key) ? "Clear kill" : "Kill"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!flagsQ.data?.length && !flagsQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-muted-foreground">No release flags registered yet.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
