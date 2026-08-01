import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useAssignOrgToReleaseCohort,
  useFeatureDefinitions,
  useFeatureKillSwitches,
  useOrgReleaseCohortMemberships,
  useReleaseCohorts,
  useReleaseFlags,
  useSetFeatureKillSwitch,
  useSetReleaseFlag,
  useUnassignOrgFromReleaseCohort,
} from "@/hooks/usePilotCohortConsole";
import { useListOrganizations } from "@/hooks/useOrganizations";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import {
  PILOT_COHORT_KEY,
  PILOT_FEATURE_KEYS,
  PILOT_FEATURE_LABELS,
  isReleaseActiveForOrg,
  type PilotFeatureKey,
} from "@/lib/pilotCohort";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Flag, Rocket, ShieldAlert, Users } from "lucide-react";

function flagBadge(mode: string, enabled: boolean) {
  if (!enabled || mode === "off") return <Badge variant="outline">off</Badge>;
  if (mode === "global") return <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">global</Badge>;
  return <Badge className="bg-blue-100 text-blue-900 hover:bg-blue-100">cohort</Badge>;
}

export default function PilotCohortConsole() {
  const { toast } = useToast();
  const cohortsQ = useReleaseCohorts();
  const flagsQ = useReleaseFlags();
  const defsQ = useFeatureDefinitions();
  const orgsQ = useListOrganizations();
  const killsQ = useFeatureKillSwitches();

  const pilotCohort = (cohortsQ.data ?? []).find((c) => c.cohort_key === PILOT_COHORT_KEY) ?? null;
  const membershipsQ = useOrgReleaseCohortMemberships(pilotCohort?.id);

  const assign = useAssignOrgToReleaseCohort();
  const unassign = useUnassignOrgFromReleaseCohort();
  const setFlag = useSetReleaseFlag();
  const setKill = useSetFeatureKillSwitch();

  const [orgId, setOrgId] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<PilotFeatureKey[]>([...PILOT_FEATURE_KEYS]);
  const [enrollReason, setEnrollReason] = useState("Pilot enrollment from operator console");
  const [orgFilter, setOrgFilter] = useState("");
  const [expiresAt, setExpiresAt] = useState(""); // optional YYYY-MM-DD
  const [membershipFilter, setMembershipFilter] = useState("");
  const [flagReason, setFlagReason] = useState("Operator release change from pilot console");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const defByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of defsQ.data ?? []) map.set(d.feature_key, d.display_name ?? d.feature_key);
    return map;
  }, [defsQ.data]);

  const pilotFlags = useMemo(
    () => (flagsQ.data ?? []).filter((f) => (PILOT_FEATURE_KEYS as readonly string[]).includes(f.feature_key)),
    [flagsQ.data],
  );

  const killSet = useMemo(() => {
    const set = new Set<string>();
    for (const k of killsQ.data ?? []) {
      if (k.is_disabled && !k.organization_id) set.add(k.feature_key);
    }
    return set;
  }, [killsQ.data]);

  const membershipRowsAll = membershipsQ.data ?? [];
  const membershipRows = useMemo(() => {
    const q = membershipFilter.trim().toLowerCase();
    if (!q) return membershipRowsAll;
    return membershipRowsAll.filter((row) =>
      (row.organization?.name ?? "").toLowerCase().includes(q)
      || row.feature_key.toLowerCase().includes(q)
      || row.organization_id.toLowerCase().includes(q)
    );
  }, [membershipRowsAll, membershipFilter]);
  const filteredOrgs = useMemo(() => {
    const rows = orgsQ.data ?? [];
    const q = orgFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((o) =>
      o.name.toLowerCase().includes(q)
      || (o.slug ?? "").toLowerCase().includes(q)
      || o.id.toLowerCase().includes(q)
    );
  }, [orgsQ.data, orgFilter]);

  const anyError = cohortsQ.isError || flagsQ.isError || membershipsQ.isError || orgsQ.isError;
  const firstError =
    (cohortsQ.error as Error | null)
    ?? (flagsQ.error as Error | null)
    ?? (membershipsQ.error as Error | null)
    ?? (orgsQ.error as Error | null);

  const toggleKey = (key: PilotFeatureKey, on: boolean) => {
    setSelectedKeys((prev) => (on ? Array.from(new Set([...prev, key])) : prev.filter((k) => k !== key)));
  };

  const handleEnroll = async () => {
    if (!pilotCohort) {
      toast({ title: "Pilot cohort missing", description: "carebase-pilot-2026 is not registered.", variant: "destructive" });
      return;
    }
    if (!orgId) {
      toast({ title: "Select an organization", variant: "destructive" });
      return;
    }
    if (enrollReason.trim().length < 8) {
      toast({ title: "Reason required", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (!selectedKeys.length) {
      toast({ title: "Pick at least one feature", variant: "destructive" });
      return;
    }
    try {
      for (const key of selectedKeys) {
        setBusyKey(key);
        await assign.mutateAsync({
          organizationId: orgId,
          cohortId: pilotCohort.id,
          featureKey: key,
          reason: enrollReason.trim(),
          expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.000Z`).toISOString() : null,
        });
      }
      toast({ title: "Organization enrolled", description: `${selectedKeys.length} feature key(s) assigned to the pilot cohort.` });
    } catch (e) {
      toast({
        title: "Enrollment failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleUnenroll = async (organizationId: string, featureKey: string) => {
    if (!pilotCohort) return;
    const reason = window.prompt("Reason for unenroll (min 8 characters)", "Remove from pilot cohort");
    if (!reason || reason.trim().length < 8) return;
    try {
      setBusyKey(`${organizationId}:${featureKey}`);
      await unassign.mutateAsync({
        organizationId,
        cohortId: pilotCohort.id,
        featureKey,
        reason: reason.trim(),
      });
      toast({ title: "Unenrolled", description: featureKey });
    } catch (e) {
      toast({
        title: "Unenroll failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleSetFlag = async (featureKey: string, mode: "cohort" | "global" | "off") => {
    if (flagReason.trim().length < 8) {
      toast({ title: "Reason required", description: "Use at least 8 characters before changing flags.", variant: "destructive" });
      return;
    }
    try {
      setBusyKey(`flag:${featureKey}:${mode}`);
      await setFlag.mutateAsync({
        featureKey,
        rolloutMode: mode === "off" ? "off" : mode,
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
      disable ? "Emergency disable from pilot console" : "Clear kill switch from pilot console",
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Rocket className="h-6 w-6" /> Pilot cohort console
          </h1>
          <p className="text-muted-foreground max-w-3xl">
            Enroll real organizations into <code className="text-xs">{PILOT_COHORT_KEY}</code>, inspect release flags,
            and manage kill switches. Writes require platform admin + MFA step-up (AAL2).
            Entitlements stay on{" "}
            <Link href="/admin/enterprise" className="text-primary underline-offset-2 hover:underline">Enterprise Foundation</Link>.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/account/security">Manage MFA</Link>
        </Button>
      </div>

      {anyError ? (
        <QueryError
          what="pilot cohort data"
          error={firstError as Error}
          onRetry={() => {
            void cohortsQ.refetch();
            void flagsQ.refetch();
            void membershipsQ.refetch();
            void orgsQ.refetch();
          }}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Flag className="h-4 w-4" /> Cohort</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p className="font-medium">{pilotCohort?.name ?? PILOT_COHORT_KEY}</p>
            <p className="text-muted-foreground">{pilotCohort ? (pilotCohort.is_active ? "Active" : "Inactive") : "Not found"}</p>
            <p className="text-xs text-muted-foreground">{pilotCohort?.description}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Enrollments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{membershipRows.length}</p>
            <p className="text-xs text-muted-foreground">Org × feature rows in this cohort</p>
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
          <CardTitle>Release flags (pilot keys)</CardTitle>
          <CardDescription>
            Cohort mode only releases enrolled orgs. Global releases everyone. Off disables for all.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xl space-y-1.5">
            <Label>Change reason (required for flag writes)</Label>
            <Input value={flagReason} onChange={(e) => setFlagReason(e.target.value)} />
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
              {pilotFlags.map((flag) => (
                <TableRow key={flag.feature_key}>
                  <TableCell>
                    <p className="font-medium text-sm">{defByKey.get(flag.feature_key) ?? PILOT_FEATURE_LABELS[flag.feature_key as PilotFeatureKey] ?? flag.feature_key}</p>
                    <p className="text-xs text-muted-foreground font-mono">{flag.feature_key}</p>
                  </TableCell>
                  <TableCell>{flagBadge(flag.rollout_mode, flag.is_enabled)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{flag.owner}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="outline" disabled={!!busyKey} onClick={() => void handleSetFlag(flag.feature_key, "cohort")}>
                      Cohort
                    </Button>
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
              {!pilotFlags.length && !flagsQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-muted-foreground">No pilot flags registered yet.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enroll organization</CardTitle>
          <CardDescription>Assign one or more pilot feature keys to an organization in the cohort.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Filter organizations</Label>
              <Input
                value={orgFilter}
                onChange={(e) => setOrgFilter(e.target.value)}
                placeholder="Search by name, slug, or id"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Organization</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
                <SelectContent>
                  {filteredOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}{org.is_demo ? " (demo)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{filteredOrgs.length} match(es)</p>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Input value={enrollReason} onChange={(e) => setEnrollReason(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Enrollment expires (optional)</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              <p className="text-xs text-muted-foreground">Leave blank for open-ended pilot membership.</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {PILOT_FEATURE_KEYS.map((key) => (
              <label key={key} className="flex items-start gap-2 rounded-lg border p-3 text-sm cursor-pointer">
                <Checkbox
                  checked={selectedKeys.includes(key)}
                  onCheckedChange={(v) => toggleKey(key, v === true)}
                />
                <span>
                  <span className="font-medium block">{PILOT_FEATURE_LABELS[key]}</span>
                  <span className="text-xs text-muted-foreground font-mono">{key}</span>
                </span>
              </label>
            ))}
          </div>
          <Button onClick={() => void handleEnroll()} disabled={!!busyKey || assign.isPending}>
            {busyKey ? `Enrolling ${busyKey}…` : "Enroll selected features"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current enrollments</CardTitle>
          <CardDescription>Who is in {PILOT_COHORT_KEY} for which feature.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 max-w-sm">
            <Input
              value={membershipFilter}
              onChange={(e) => setMembershipFilter(e.target.value)}
              placeholder="Filter enrollments by org or feature"
            />
          </div>
          {membershipsQ.isLoading ? (
            <div className="h-24 animate-pulse rounded bg-muted" />
          ) : !membershipRows.length ? (
            <p className="text-sm text-muted-foreground">No enrollments yet. Demo orgs are enrolled by migration when is_demo is true.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Feature</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {membershipRows.map((row) => {
                  const flag = (flagsQ.data ?? []).find((f) => f.feature_key === row.feature_key);
                  const effective = isReleaseActiveForOrg({
                    isEnabled: !!flag?.is_enabled,
                    rolloutMode: flag?.rollout_mode ?? "off",
                    expiresAt: flag?.expires_at,
                    orgEnrolled: true,
                    killDisabled: killSet.has(row.feature_key),
                  });
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <p className="font-medium text-sm">{row.organization?.name ?? row.organization_id}</p>
                        {row.organization?.is_demo ? <Badge variant="outline" className="text-[10px]">demo</Badge> : null}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{row.feature_key}</TableCell>
                      <TableCell>
                        {effective
                          ? <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">active</Badge>
                          : <Badge variant="outline">inactive</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate">{row.reason}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!busyKey}
                          onClick={() => void handleUnenroll(row.organization_id, row.feature_key)}
                        >
                          Unenroll
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
