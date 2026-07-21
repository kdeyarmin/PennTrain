import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, CheckCircle2, ClipboardCheck, Download, FileText,
  FolderOpen, Loader2, RefreshCw, ShieldCheck, Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListTrainingRecords } from "@/hooks/useTrainingRecords";
import { useListEmployeeCredentials } from "@/hooks/useEmployeeCredentials";
import { useListInspectionItems } from "@/hooks/useInspectionItems";
import { useListBinderExports, useGetBinderExport, useBinderDownloadUrl } from "@/hooks/useComplianceBinder";
import { useListEvidenceCollections } from "@/hooks/useEvidenceRoom";
import { useOrgFeatureEnabled } from "@/hooks/useFeatureRelease";
import { useListMyFacilityAssignments } from "@/hooks/useFacilityAssignments";
import { BinderExportButton } from "@/components/reports/BinderExportButton";
import {
  useActiveSurveyDaySession, useSurveyDayWorkspace, useSurveyDayStaffRoster,
  useActivateSurveyDay, useRefreshSurveyDay, useSetSurveyDayDisposition, useCloseSurveyDay,
  type SurveyDayChecklistItem, type SurveyDayDisposition, type ReadinessState,
} from "@/hooks/useSurveyDay";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { QueryError, QueryLoading } from "@/components/QueryState";

// Mirrors the server-side assert_survey_day_manager gate (app_private.assert_phase5_manager):
// only these roles may activate/refresh/close a session or record a disposition. Auditors reach the
// page through REPORTS_VIEW_ROLES and must see it strictly read-only rather than controls that only
// fail with a 42501 on click.
const SURVEY_DAY_MANAGE_ROLES = ["platform_admin", "org_admin", "facility_manager"];

const HEALTH_CREDENTIAL_TYPES = ["tb_screening", "immunization"];
const BACKGROUND_CREDENTIAL_TYPES = ["act34_criminal_history", "act73_fbi_fingerprint", "act33_child_abuse"];
const OUTSTANDING = ["expired", "due_soon", "missing"];
const DISPOSITIONS: Array<{ value: SurveyDayDisposition; label: string }> = [
  { value: "ready", label: "Ready" },
  { value: "provided", label: "Provided" },
  { value: "not_requested", label: "Not requested" },
  { value: "needs_follow_up", label: "Needs follow-up" },
];

function readinessLabel(level: ReadinessState) {
  return level === "ready" ? "Ready" : level === "attention" ? "Attention" : "Manual review";
}

function ReadinessChip({ level, detail }: { level: ReadinessState; detail?: string }) {
  const styles = level === "ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : level === "attention"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>
      {level === "ready" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {readinessLabel(level)}{detail ? ` · ${detail}` : ""}
    </span>
  );
}

function displayDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function SurveyDay() {
  const { user } = useAuth();
  const { toast } = useToast();
  const initialFacility = useMemo(() => new URLSearchParams(window.location.search).get("facility") ?? "", []);
  const [facilityId, setFacilityId] = useState(initialFacility);
  const { data: facilities } = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const activeFacilityId = facilityId || facilities?.[0]?.id || "";
  const activeFacility = facilities?.find((f) => f.id === activeFacilityId);

  // A facility_manager is additionally facility-scoped server-side (assert_phase5_manager ->
  // is_assigned_to_facility); org/platform admins are not. The facility dropdown is org-wide, so
  // gate manage rights on the *selected* facility too -- otherwise a manager who picks a facility
  // they aren't assigned to would still see Start controls the backend rejects with 42501.
  const myAssignments = useListMyFacilityAssignments(user?.id, user?.role === "facility_manager");
  const assignedFacilityIds = useMemo(() => new Set((myAssignments.data ?? []).map((a) => a.facility_id)), [myAssignments.data]);
  const roleCanManage = !!user && SURVEY_DAY_MANAGE_ROLES.includes(user.role);
  const canManage = roleCanManage
    && (user?.role !== "facility_manager" || (!!activeFacilityId && assignedFacilityIds.has(activeFacilityId)));

  const session = useActiveSurveyDaySession(activeFacilityId || undefined);

  // Gate on the org's survey_day_mode entitlement, mirroring the backend command guard. Platform
  // admins bypass the flag server-side, so never block them; for everyone else, once the read
  // resolves to false show a "not enabled" state instead of activation controls that would 42501.
  const surveyDayFeature = useOrgFeatureEnabled("survey_day_mode");
  const featureBlocked = !!user && user.role !== "platform_admin" && !surveyDayFeature.isLoading && !surveyDayFeature.isEnabled;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6" /><h1 className="text-2xl font-bold tracking-tight">Survey Day Mode</h1></div>
          <p className="max-w-3xl text-muted-foreground">
            One focused workspace for when a licensing representative arrives. It composes your existing
            entrance-conference checklist, compliance binder, staff readiness, and evidence room.
          </p>
        </div>
        <div className="w-full md:w-72">
          <label className="mb-1 block text-sm font-medium">Facility</label>
          <Select value={activeFacilityId} onValueChange={setFacilityId}>
            <SelectTrigger><SelectValue placeholder="Select facility" /></SelectTrigger>
            <SelectContent>{(facilities ?? []).map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {featureBlocked ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Survey Day Mode isn&apos;t enabled for your organization yet. Contact CareMetric to join the pilot.
        </CardContent></Card>
      ) : !activeFacilityId ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Select a facility to begin.</CardContent></Card>
      ) : session.isLoading ? (
        <QueryLoading what="the Survey Day session" />
      ) : session.isError ? (
        <QueryError what="the Survey Day session" error={session.error as Error} onRetry={() => session.refetch()} />
      ) : session.data ? (
        <Workspace sessionId={session.data.id} facilityId={activeFacilityId} facilityName={activeFacility?.name ?? "Facility"} canManage={canManage} />
      ) : canManage ? (
        <ActivationCard
          facilityId={activeFacilityId}
          facilityName={activeFacility?.name ?? "Facility"}
          facilityType={activeFacility?.facility_type ?? ""}
          organizationId={user?.organizationId ?? ""}
          onActivated={() => session.refetch()}
        />
      ) : (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No Survey Day session is active for {activeFacility?.name ?? "this facility"}. A facility manager or organization administrator can start one.
        </CardContent></Card>
      )}
    </div>
  );

  function ActivationCard({ facilityId, facilityName, facilityType, organizationId, onActivated }: {
    facilityId: string; facilityName: string; facilityType: string; organizationId: string; onActivated: () => void;
  }) {
    const activate = useActivateSurveyDay();
    const { data: binders } = useListBinderExports({ organizationId: organizationId || undefined });
    const { data: collections } = useListEvidenceCollections({ organizationId: organizationId || undefined });
    const latestBinder = (binders ?? []).find((b: any) => b.status === "succeeded" && Array.isArray(b.facility_ids) && b.facility_ids.length === 1 && b.facility_ids[0] === facilityId);
    const latestCollection = (collections ?? []).find((c: any) => c.facility_id === facilityId && c.status === "published");

    const start = () => activate.mutate(facilityId, {
      onSuccess: onActivated,
      onError: (error: Error) => toast({ title: "Could not start Survey Day", description: error.message, variant: "destructive" }),
    });

    return (
      <Card>
        <CardHeader>
          <CardTitle>Start Survey Day for {facilityName}</CardTitle>
          <CardDescription>{facilityType === "ALR" ? "Assisted Living Facility" : facilityType || "Facility"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">Latest single-facility binder</p>
              <p className="text-muted-foreground">{latestBinder ? displayDate(latestBinder.completed_at) : "No completed binder yet"}</p>
            </div>
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">Latest published evidence collection</p>
              <p className="text-muted-foreground">{latestCollection ? (latestCollection as any).name : "No published collection yet"}</p>
            </div>
          </div>
          <Alert>
            <ClipboardCheck className="h-4 w-4" />
            <AlertTitle>Starting Survey Day is audit-logged</AlertTitle>
            <AlertDescription>Activation records who started the mode, for which facility, and when. Existing binder, evidence, and guest-access controls remain explicit and unchanged.</AlertDescription>
          </Alert>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="lg" disabled={activate.isPending}>{activate.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting…</> : <><ShieldCheck className="mr-2 h-4 w-4" />Start Survey Day</>}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start Survey Day for {facilityName}?</AlertDialogTitle>
                <AlertDialogDescription>This opens the focused survey workspace and records an audit event. You can close it at any time with a reason.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={start}>Start Survey Day</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    );
  }
}

function Workspace({ sessionId, facilityId, facilityName, canManage }: { sessionId: string; facilityId: string; facilityName: string; canManage: boolean }) {
  const { toast } = useToast();
  const workspace = useSurveyDayWorkspace(sessionId);
  const refresh = useRefreshSurveyDay(facilityId);
  const close = useCloseSurveyDay(facilityId);
  const [closeReason, setCloseReason] = useState("");

  if (workspace.isLoading) return <QueryLoading what="the survey workspace" />;
  if (workspace.isError) return <QueryError what="the survey workspace" error={workspace.error as Error} onRetry={() => workspace.refetch()} />;
  const data = workspace.data!;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Survey Day active — {facilityName}</CardTitle>
              <CardDescription>
                Active since {displayDate(data.session.activatedAt)} · started by {data.session.activatedByName ?? "a manager"} · last refreshed {displayDate(data.session.lastRefreshedAt)}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {canManage && (<>
              <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate(sessionId, { onError: (e: Error) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" }) })}>
                {refresh.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh live checks
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="destructive">Close Survey Day</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Close Survey Day</AlertDialogTitle>
                    <AlertDialogDescription>Closing records the reason, actor, and time. Closed sessions are read-only.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <Textarea value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="Reason for closing (required)" rows={3} />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={closeReason.trim().length < 3 || close.isPending}
                      onClick={() => close.mutate({ sessionId, reason: closeReason.trim() }, { onError: (e: Error) => toast({ title: "Could not close", description: e.message, variant: "destructive" }) })}
                    >Close session</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              </>)}
            </div>
          </div>
        </CardHeader>
      </Card>

      <EntranceConferenceSection sessionId={sessionId} facilityId={facilityId} checklist={data.checklist} readOnly={data.session.status !== "active" || !canManage} />
      <BinderSection sessionId={sessionId} facilityId={facilityId} organizationId={data.session.organizationId} pinnedBinderJobId={data.session.pinnedBinderJobId} />
      <StaffRosterSection sessionId={sessionId} />
      <EvidenceSection organizationId={data.session.organizationId} facilityId={facilityId} pinnedCollectionId={data.session.pinnedEvidenceCollectionId} />
    </div>
  );
}

function EntranceConferenceSection({ sessionId, facilityId, checklist, readOnly }: {
  sessionId: string; facilityId: string; checklist: SurveyDayChecklistItem[]; readOnly: boolean;
}) {
  const { toast } = useToast();
  const setDisposition = useSetSurveyDayDisposition();
  const { data: employees } = useListEmployees({ facilityId, status: "active" });
  const { data: training } = useListTrainingRecords({ facilityId });
  const { data: credentials } = useListEmployeeCredentials({ facilityId });
  const { data: inspections } = useListInspectionItems({ facilityId, isActive: true });

  function liveReadiness(dataSource: string, itemTypes: string[] | null): { level: ReadinessState; detail?: string } {
    switch (dataSource) {
      case "roster": {
        const count = employees?.length ?? 0;
        return count > 0 ? { level: "ready", detail: `${count} active` } : { level: "attention", detail: "no active staff" };
      }
      case "training": {
        const n = (training ?? []).filter((r: any) => OUTSTANDING.includes(r.status)).length;
        return n === 0 ? { level: "ready" } : { level: "attention", detail: `${n} outstanding` };
      }
      case "credentials": {
        const n = (credentials ?? []).filter((c: any) => HEALTH_CREDENTIAL_TYPES.includes(c.credential_type) && OUTSTANDING.includes(c.status)).length;
        return n === 0 ? { level: "ready" } : { level: "attention", detail: `${n} outstanding` };
      }
      case "background_checks": {
        const n = (credentials ?? []).filter((c: any) => BACKGROUND_CREDENTIAL_TYPES.includes(c.credential_type) && OUTSTANDING.includes(c.status)).length;
        return n === 0 ? { level: "ready" } : { level: "attention", detail: `${n} outstanding` };
      }
      case "inspections": {
        // Only count inspection items whose type this checklist row actually covers (its item_types
        // snapshot). Without this, one unrelated overdue inspection would flip every inspection
        // prompt -- fire drills, extinguisher/alarm checks, emergency plan -- to Attention.
        const scoped = (inspections ?? []).filter((i: any) =>
          !itemTypes || itemTypes.length === 0 || itemTypes.includes(i.item_type));
        const n = scoped.filter((i: any) => OUTSTANDING.includes(i.status)).length;
        return n === 0 ? { level: "ready" } : { level: "attention", detail: `${n} outstanding` };
      }
      default:
        return { level: "unknown" };
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Entrance conference</CardTitle>
        <CardDescription>Activation-time checklist with live derived readiness. Record a disposition per item — a system check being ready never marks an item “Provided”.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {checklist.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entrance-conference items were configured at activation.</p>
        ) : checklist.map((item) => {
          const live = liveReadiness(item.dataSource, item.itemTypes);
          return (
            <div key={item.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.category}</p>
                  <p className="font-medium">{item.prompt}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <ReadinessChip level={live.level} detail={live.detail} />
                    <span className="text-xs text-muted-foreground">source: {item.dataSource.replace(/_/g, " ")}</span>
                  </div>
                </div>
                <div className="w-full sm:w-52">
                  <Select
                    value={item.disposition ?? ""}
                    disabled={readOnly || setDisposition.isPending}
                    onValueChange={(value) => setDisposition.mutate(
                      { sessionId, itemId: item.id, disposition: value as SurveyDayDisposition, note: item.dispositionNote ?? "" },
                      { onError: (e: Error) => toast({ title: "Could not save disposition", description: e.message, variant: "destructive" }) },
                    )}
                  >
                    <SelectTrigger><SelectValue placeholder="Set disposition" /></SelectTrigger>
                    <SelectContent>{DISPOSITIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {item.disposition && <p className="mt-1 text-xs text-muted-foreground">Recorded {displayDate(item.dispositionAt)}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function BinderSection({ sessionId, facilityId, organizationId, pinnedBinderJobId }: { sessionId: string; facilityId: string; organizationId: string; pinnedBinderJobId: string | null }) {
  const { toast } = useToast();
  const { data: pinned } = useGetBinderExport(pinnedBinderJobId ?? undefined);
  const download = useBinderDownloadUrl();
  const queryClient = useQueryClient();
  const completedAt = pinned?.completed_at as string | undefined;
  const isCurrent = completedAt ? (Date.now() - new Date(completedAt).valueOf()) < 24 * 60 * 60 * 1000 : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Compliance binder</CardTitle>
        <CardDescription>The pinned single-facility binder. Generate a fresh one without leaving Survey Day; the current binder stays usable while it renders.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pinnedBinderJobId && pinned ? (
          <div className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">Generated {displayDate(completedAt)}</p>
                <p className="text-muted-foreground">
                  Checksum {pinned.content_sha256 ? String(pinned.content_sha256).slice(0, 12) + "…" : "not recorded"}
                </p>
              </div>
              <Badge variant="outline" className={isCurrent ? "border-emerald-200 text-emerald-700" : "border-amber-200 text-amber-800"}>
                {isCurrent ? "Current (under 24h)" : "Stale (over 24h)"}
              </Badge>
            </div>
            {pinned.status === "succeeded" && (
              <Button
                variant="outline" size="sm" className="mt-3" disabled={download.isPending}
                onClick={() => download.mutate(pinned.id, {
                  onSuccess: (result) => { if (result?.url) window.open(result.url, "_blank", "noopener"); },
                  onError: (e: Error) => toast({ title: "Download failed", description: e.message, variant: "destructive" }),
                })}
              ><Download className="mr-2 h-4 w-4" />Download binder</Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No binder is pinned yet. Generate one below or from the Compliance Binder page.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <BinderExportButton
            organizationId={organizationId}
            facilityIds={[facilityId]}
            label="Generate fresh binder"
            // The pin itself happens server-side: a DB trigger pins any completed single-facility
            // binder to the facility's active session, so it works even after the user leaves this
            // page while the PDF renders (the export runs in the background). Here we only need to
            // refetch the workspace so the freshly pinned binder shows immediately for a user who
            // stayed; a multi-facility export can't match a single-facility session, so skip it.
            onCompleted={(_jobId, facilityIds) => {
              if (facilityIds && facilityIds.length === 1 && facilityIds[0] === facilityId) {
                queryClient.invalidateQueries({ queryKey: ["survey-day-workspace", sessionId] });
              }
            }}
          />
          <Button asChild variant="ghost" size="sm"><Link href="/app/compliance-binder">Open Compliance Binder</Link></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StaffRosterSection({ sessionId }: { sessionId: string }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const roster = useSurveyDayStaffRoster(sessionId, search, page, pageSize);
  const data = roster.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.count / data.pageSize)) : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Staff readiness roster</CardTitle>
        <CardDescription>Active staff with training, credential, background, and exclusion flags. Minimum-necessary status only — no contact details or documents.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search staff by name or title"
            className="max-w-xs"
          />
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{[25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}</SelectContent>
          </Select>
          {data && (
            <div className="ml-auto flex gap-2 text-sm">
              <Badge variant="outline">{data.summary.total} total</Badge>
              <Badge variant="outline" className="border-emerald-200 text-emerald-700">{data.summary.ready} ready</Badge>
              <Badge variant="outline" className="border-amber-200 text-amber-800">{data.summary.attention} attention</Badge>
            </div>
          )}
        </div>

        {roster.isLoading ? (
          <QueryLoading what="the staff roster" />
        ) : roster.isError ? (
          <QueryError what="the staff roster" error={roster.error as Error} onRetry={() => roster.refetch()} />
        ) : !data || data.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No active staff match this filter.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Staff</th><th className="px-3">Training</th><th className="px-3">Credentials</th>
                    <th className="px-3">Background</th><th className="px-3">Exclusion</th><th className="px-3">Overall</th><th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.employeeId} className="border-b last:border-0">
                      <td className="py-2 pr-3"><span className="font-medium">{row.name}</span>{row.jobTitle ? <span className="block text-xs text-muted-foreground">{row.jobTitle}</span> : null}</td>
                      <td className="px-3"><ReadinessChip level={row.trainingState} /></td>
                      <td className="px-3"><ReadinessChip level={row.credentialState} /></td>
                      <td className="px-3"><ReadinessChip level={row.backgroundState} /></td>
                      <td className="px-3"><ReadinessChip level={row.exclusionState} /></td>
                      <td className="px-3"><ReadinessChip level={row.overallFlag} /></td>
                      <td className="px-3 text-right"><Button asChild variant="ghost" size="sm"><Link href={row.route}>Open</Link></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {data.rows.map((row) => (
                <div key={row.employeeId} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div><p className="font-medium">{row.name}</p>{row.jobTitle ? <p className="text-xs text-muted-foreground">{row.jobTitle}</p> : null}</div>
                    <ReadinessChip level={row.overallFlag} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <ReadinessChip level={row.trainingState} detail="training" />
                    <ReadinessChip level={row.credentialState} detail="credentials" />
                    <ReadinessChip level={row.backgroundState} detail="background" />
                    <ReadinessChip level={row.exclusionState} detail="exclusion" />
                  </div>
                  <Button asChild variant="ghost" size="sm" className="mt-2"><Link href={row.route}>Open employee</Link></Button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1 text-sm">
              <span className="text-muted-foreground">Page {data.page} of {totalPages} · {data.count} staff</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EvidenceSection({ organizationId, facilityId, pinnedCollectionId }: { organizationId: string; facilityId: string; pinnedCollectionId: string | null }) {
  const { data: collections } = useListEvidenceCollections({ organizationId: organizationId || undefined });
  const pinned = (collections ?? []).find((c: any) => c.id === pinnedCollectionId)
    ?? (collections ?? []).find((c: any) => c.facility_id === facilityId && c.status === "published");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" />Evidence room</CardTitle>
        <CardDescription>Internal quick links to the facility’s current collection and access controls. Guest links stay in the existing explicit publish/grant flow.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pinned ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <div>
              <p className="font-medium">{(pinned as any).name}</p>
              <p className="text-muted-foreground">Published {displayDate((pinned as any).published_at)}</p>
            </div>
            <Button asChild variant="outline" size="sm"><Link href={`/app/evidence/${(pinned as any).id}`}>Open collection</Link></Button>
          </div>
        ) : (
          <Alert>
            <FolderOpen className="h-4 w-4" />
            <AlertTitle>No published collection</AlertTitle>
            <AlertDescription>Survey Day is not blocked. Open the Evidence Room to prepare a collection if you need one.</AlertDescription>
          </Alert>
        )}
        <Button asChild variant="ghost" size="sm"><Link href="/app/evidence">Open Evidence Room</Link></Button>
      </CardContent>
    </Card>
  );
}
