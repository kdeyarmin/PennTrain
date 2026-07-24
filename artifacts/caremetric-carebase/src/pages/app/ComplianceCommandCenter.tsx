import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useUrlState } from "@/hooks/useUrlState";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import {
  useComplianceInstances,
  useComplianceRequirements,
  useComplianceFacilityBuildings,
  useGenerateComplianceInstancesNow,
  useSetComplianceRequirementActive,
  type ComplianceInstance,
  type ComplianceRequirement,
} from "@/hooks/useComplianceRequirements";
import {
  categoryLabel, chapterLabel, COMPLIANCE_CATEGORIES, COMPLIANCE_STATUSES, CHAPTER_OPTIONS,
  computeComplianceScore, effectiveStatus, isDueSoon, isMissingEvidence, recurrenceLabel,
  statusBadgeClassName, statusLabel, summarizeInstances, type InstanceLike,
} from "@/lib/complianceCommandCenter";
import { formatDateForDisplay, formatDueDistance } from "@/lib/dateUtils";
import { downloadCsv } from "@/lib/csv";
import { StatCard } from "@/components/StatCard";
import { QueryError } from "@/components/QueryState";
import { RequirementEditorDialog } from "@/components/compliance/RequirementEditorDialog";
import { InstanceDetailDialog } from "@/components/compliance/InstanceDetailDialog";
import { CopyTemplateDialog } from "@/components/compliance/CopyTemplateDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle, CalendarClock, ClipboardCheck, ClipboardList, Copy, Download, FileWarning,
  Gauge, Pencil, Plus, RefreshCw, Search, ShieldCheck, X,
} from "lucide-react";

const DEFAULTS = {
  tab: "dashboard", facility: "all", building: "all", category: "all", chapter: "all",
  responsible: "all", status: "all", view: "all", search: "", dueFrom: "", dueTo: "",
};

type Row = ComplianceInstance & { requirement?: ComplianceRequirement };

function asLike(r: Row): InstanceLike {
  return {
    status: r.status,
    due_date: r.due_date,
    evidence_count: r.evidence_count,
    requires_evidence: r.requirement?.requires_evidence ?? false,
    warning_days: r.requirement?.warning_days ?? 14,
  };
}

function scoreTone(score: number | null): "success" | "warning" | "danger" | "default" {
  if (score === null) return "default";
  if (score >= 90) return "success";
  if (score >= 70) return "warning";
  return "danger";
}

export default function ComplianceCommandCenter() {
  const { user } = useAuth();
  const canManage = user?.role === "org_admin" || user?.role === "facility_manager";

  const [urlState, setUrlState] = useUrlState(DEFAULTS);
  const set = (patch: Partial<typeof DEFAULTS>) => setUrlState(patch);

  const requirementsQ = useComplianceRequirements({ scope: "live", includeArchived: true });
  const templatesQ = useComplianceRequirements({ scope: "template", includeArchived: true });
  const instancesQ = useComplianceInstances();
  const { data: facilities } = useListFacilities();
  const { data: profiles } = useListProfiles();
  const { data: buildings } = useComplianceFacilityBuildings(urlState.facility !== "all" ? urlState.facility : undefined);

  const generateNow = useGenerateComplianceInstancesNow();
  const setActive = useSetComplianceRequirementActive();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ComplianceRequirement | null>(null);
  const [editorTemplate, setEditorTemplate] = useState(false);
  const [detail, setDetail] = useState<{ requirementId: string; instanceId: string } | null>(null);
  const [copyTemplate, setCopyTemplate] = useState<ComplianceRequirement | null>(null);

  const requirements = requirementsQ.data ?? [];
  const reqById = useMemo(() => new Map(requirements.map((r) => [r.id, r])), [requirements]);
  const facilityName = (id: string | null | undefined) => facilities?.find((f) => f.id === id)?.name ?? "—";
  const profileName = (id: string | null | undefined) => {
    const p = profiles?.find((x) => x.id === id);
    return p ? `${p.first_name} ${p.last_name}` : id ? "Someone" : "Unassigned";
  };
  const buildingName = (id: string | null | undefined) => buildings?.find((b) => b.id === id)?.name ?? "";

  const rows: Row[] = useMemo(
    () => (instancesQ.data ?? []).map((i) => ({ ...i, requirement: reqById.get(i.requirement_id) })),
    [instancesQ.data, reqById],
  );

  const orgProfiles = useMemo(
    () => (profiles ?? []).filter((p) => p.is_active && ["org_admin", "facility_manager", "trainer"].includes(p.role)),
    [profiles],
  );

  // Everything except the status / metric-view narrowing -> drives the metric cards + score.
  const scoped: Row[] = useMemo(() => {
    const q = urlState.search.trim().toLowerCase();
    return rows.filter((r) => {
      if (urlState.facility !== "all" && r.facility_id !== urlState.facility) return false;
      if (urlState.building !== "all" && r.building_id !== urlState.building) return false;
      if (urlState.category !== "all" && r.requirement?.category !== urlState.category) return false;
      if (urlState.chapter !== "all" && r.requirement?.regulation_chapter !== urlState.chapter) return false;
      if (urlState.responsible !== "all" && r.responsible_profile_id !== urlState.responsible) return false;
      if (urlState.dueFrom && r.due_date < urlState.dueFrom) return false;
      if (urlState.dueTo && r.due_date > urlState.dueTo) return false;
      if (q) {
        const hay = [r.requirement?.title, categoryLabel(r.requirement?.category), r.requirement?.regulation_citation, facilityName(r.facility_id), profileName(r.responsible_profile_id)]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, urlState, facilities, profiles]);

  const summary = useMemo(() => summarizeInstances(scoped.map(asLike)), [scoped]);

  const tableRows = useMemo(() => {
    const filtered = scoped.filter((r) => {
      const es = effectiveStatus(asLike(r));
      if (urlState.status !== "all" && es !== urlState.status) return false;
      switch (urlState.view) {
        case "overdue": return es === "overdue";
        case "due_soon": return isDueSoon(asLike(r));
        case "awaiting_review": return es === "awaiting_review";
        case "missing_evidence": return isMissingEvidence(asLike(r));
        default: return true;
      }
    });
    const rank: Record<string, number> = { overdue: 0, awaiting_review: 1, in_progress: 2, not_started: 3, exception_approved: 4, complete: 5, not_applicable: 6 };
    return filtered.sort((a, b) => {
      const ra = rank[effectiveStatus(asLike(a))] ?? 9;
      const rb = rank[effectiveStatus(asLike(b))] ?? 9;
      return ra - rb || a.due_date.localeCompare(b.due_date);
    });
  }, [scoped, urlState.status, urlState.view]);

  const perFacility = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      if (!groups.has(r.facility_id)) groups.set(r.facility_id, []);
      groups.get(r.facility_id)!.push(r);
    }
    return [...groups.entries()]
      .map(([id, list]) => ({ id, name: facilityName(id), score: computeComplianceScore(list.map(asLike)), summary: summarizeInstances(list.map(asLike)) }))
      .sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  }, [rows, facilities]);

  const hasFilters = urlState.facility !== "all" || urlState.building !== "all" || urlState.category !== "all"
    || urlState.chapter !== "all" || urlState.responsible !== "all" || urlState.status !== "all"
    || urlState.view !== "all" || urlState.search !== "" || urlState.dueFrom !== "" || urlState.dueTo !== "";

  function exportCsv() {
    downloadCsv(
      `compliance-requirements-${new Date().toISOString().slice(0, 10)}.csv`,
      tableRows.map((r) => ({
        Requirement: r.requirement?.title ?? "",
        Category: categoryLabel(r.requirement?.category),
        Facility: facilityName(r.facility_id),
        Building: buildingName(r.building_id),
        Regulation: r.requirement?.regulation_citation ?? chapterLabel(r.requirement?.regulation_chapter),
        Cadence: recurrenceLabel(r.requirement?.recurrence, r.requirement?.custom_interval_days),
        "Due date": r.due_date,
        Responsible: profileName(r.responsible_profile_id),
        Status: statusLabel(effectiveStatus(asLike(r))),
        Evidence: r.evidence_count,
      })),
    );
  }

  function openEditor(requirement: ComplianceRequirement | null, template: boolean) {
    setEditing(requirement);
    setEditorTemplate(template);
    setEditorOpen(true);
  }

  if (instancesQ.isError || requirementsQ.isError) {
    return <div className="space-y-6"><QueryError what="compliance requirements" error={(instancesQ.error ?? requirementsQ.error) as Error} onRetry={() => { instancesQ.refetch(); requirementsQ.refetch(); }} /></div>;
  }

  const templates = templatesQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compliance Command Center</h1>
          <p className="text-muted-foreground">
            One register for every recurring facility obligation — by facility, building, category, and regulation — tracked to completion with evidence, review, and history.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => openEditor(null, true)}><ClipboardList className="mr-1.5 h-4 w-4" />New template</Button>
            <Button onClick={() => openEditor(null, false)}><Plus className="mr-1.5 h-4 w-4" />New requirement</Button>
          </div>
        )}
      </div>

      <Tabs value={urlState.tab} onValueChange={(v) => set({ tab: v })}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="requirements">Requirements</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        {/* ---------------- Dashboard ---------------- */}
        <TabsContent value="dashboard" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Compliance score" value={summary.score === null ? "—" : `${summary.score}%`} icon={Gauge} tone={scoreTone(summary.score)}
              hint={`${summary.resolved} met · ${summary.open} open`} />
            <StatCard label="Overdue" value={summary.overdue} icon={AlertTriangle} tone="danger"
              onClick={() => set({ view: urlState.view === "overdue" ? "all" : "overdue", status: "all" })} hint="Past due, unresolved" />
            <StatCard label="Due soon" value={summary.dueSoon} icon={CalendarClock} tone="warning"
              onClick={() => set({ view: urlState.view === "due_soon" ? "all" : "due_soon", status: "all" })} hint="Within warning window" />
            <StatCard label="Awaiting review" value={summary.awaitingReview} icon={ClipboardCheck} tone="info"
              onClick={() => set({ view: urlState.view === "awaiting_review" ? "all" : "awaiting_review", status: "all" })} hint="Submitted for sign-off" />
            <StatCard label="Missing evidence" value={summary.missingEvidence} icon={FileWarning} tone="default"
              onClick={() => set({ view: urlState.view === "missing_evidence" ? "all" : "missing_evidence", status: "all" })} hint="Evidence required, none attached" />
          </div>

          {urlState.facility === "all" && perFacility.length > 1 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Compliance by facility</CardTitle></CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {perFacility.map((f) => (
                  <button key={f.id} onClick={() => set({ facility: f.id, view: "all" })}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50">
                    <span className="truncate">{f.name}</span>
                    <span className="flex items-center gap-2">
                      {f.summary.overdue > 0 && <Badge variant="outline" className={statusBadgeClassName("overdue")}>{f.summary.overdue} overdue</Badge>}
                      <span className="font-semibold">{f.score === null ? "—" : `${f.score}%`}</span>
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="w-56 pl-8" placeholder="Search requirements…" value={urlState.search} onChange={(e) => set({ search: e.target.value })} />
            </div>
            <Select value={urlState.facility} onValueChange={(v) => set({ facility: v, building: "all" })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All facilities</SelectItem>
                {(facilities ?? []).map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {urlState.facility !== "all" && (buildings ?? []).length > 0 && (
              <Select value={urlState.building} onValueChange={(v) => set({ building: v })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All buildings</SelectItem>
                  {(buildings ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={urlState.category} onValueChange={(v) => set({ category: v })}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {COMPLIANCE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={urlState.chapter} onValueChange={(v) => set({ chapter: v })}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Regulation" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regulations</SelectItem>
                {CHAPTER_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={urlState.responsible} onValueChange={(v) => set({ responsible: v })}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Responsible" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Anyone responsible</SelectItem>
                {orgProfiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={urlState.status} onValueChange={(v) => set({ status: v, view: "all" })}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {COMPLIANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" className="w-40" value={urlState.dueFrom} onChange={(e) => set({ dueFrom: e.target.value })} aria-label="Due from" />
            <Input type="date" className="w-40" value={urlState.dueTo} onChange={(e) => set({ dueTo: e.target.value })} aria-label="Due to" />
            {hasFilters && <Button variant="ghost" size="sm" onClick={() => set(DEFAULTS)}><X className="mr-1 h-3.5 w-3.5" />Clear</Button>}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={tableRows.length === 0}><Download className="mr-1 h-3.5 w-3.5" />Export CSV</Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {instancesQ.isLoading ? (
                <p className="p-8 text-center text-muted-foreground">Loading…</p>
              ) : tableRows.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground">
                  <ShieldCheck className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  <p>{rows.length === 0 ? "No compliance requirements yet." : "No occurrences match these filters."}</p>
                  {canManage && rows.length === 0 && <Button className="mt-3" size="sm" onClick={() => openEditor(null, false)}><Plus className="mr-1.5 h-4 w-4" />Create your first requirement</Button>}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Requirement</TableHead>
                        <TableHead>Facility</TableHead>
                        <TableHead>Regulation</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead>Responsible</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Evidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tableRows.map((r) => {
                        const es = effectiveStatus(asLike(r));
                        const missing = isMissingEvidence(asLike(r));
                        return (
                          <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetail({ requirementId: r.requirement_id, instanceId: r.id })}>
                            <TableCell>
                              <div className="font-medium">{r.requirement?.title ?? "—"}</div>
                              <div className="text-xs text-muted-foreground">{categoryLabel(r.requirement?.category)}{buildingName(r.building_id) ? ` · ${buildingName(r.building_id)}` : ""}</div>
                            </TableCell>
                            <TableCell className="text-sm">{facilityName(r.facility_id)}</TableCell>
                            <TableCell className="text-sm">{r.requirement?.regulation_citation ?? chapterLabel(r.requirement?.regulation_chapter)}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {formatDateForDisplay(r.due_date)}
                              <div className="text-xs text-muted-foreground">{formatDueDistance(r.due_date)}</div>
                            </TableCell>
                            <TableCell className="text-sm">{profileName(r.responsible_profile_id)}</TableCell>
                            <TableCell><Badge variant="outline" className={statusBadgeClassName(es)}>{statusLabel(es)}</Badge></TableCell>
                            <TableCell className="text-sm">
                              {missing ? <span className="text-destructive">Missing</span> : r.evidence_count > 0 ? `${r.evidence_count} file(s)` : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Requirements ---------------- */}
        <TabsContent value="requirements" className="space-y-4">
          {requirementsQ.isLoading ? <p className="p-8 text-center text-muted-foreground">Loading…</p> : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Requirement</TableHead>
                      <TableHead>Facility</TableHead>
                      <TableHead>Regulation</TableHead>
                      <TableHead>Cadence</TableHead>
                      <TableHead>Responsible</TableHead>
                      <TableHead>Active</TableHead>
                      {canManage && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requirements.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.title}</div>
                          <div className="text-xs text-muted-foreground">{categoryLabel(r.category)}</div>
                        </TableCell>
                        <TableCell className="text-sm">{facilityName(r.facility_id)}</TableCell>
                        <TableCell className="text-sm">{r.regulation_citation ?? chapterLabel(r.regulation_chapter)}</TableCell>
                        <TableCell className="text-sm">{recurrenceLabel(r.recurrence, r.custom_interval_days)}</TableCell>
                        <TableCell className="text-sm">{profileName(r.responsible_profile_id)}</TableCell>
                        <TableCell>{r.is_active ? <Badge variant="outline" className="bg-success/10 text-success-strong">Active</Badge> : <Badge variant="outline" className="bg-muted text-muted-foreground">Archived</Badge>}</TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Generate upcoming occurrences" onClick={() => generateNow.mutate(r.id)}><RefreshCw className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => openEditor(r, false)}><Pencil className="h-4 w-4" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => setActive.mutate({ requirementId: r.id, active: !r.is_active })}>{r.is_active ? "Archive" : "Restore"}</Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {requirements.length === 0 && <TableRow><TableCell colSpan={canManage ? 7 : 6} className="p-8 text-center text-muted-foreground">No requirements defined yet.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------------- Templates ---------------- */}
        <TabsContent value="templates" className="space-y-4">
          <p className="text-sm text-muted-foreground">Reusable requirement definitions you can deploy across multiple facilities in one step.</p>
          {templatesQ.isLoading ? <p className="p-8 text-center text-muted-foreground">Loading…</p> : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Template</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Regulation</TableHead>
                      <TableHead>Cadence</TableHead>
                      {canManage && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.title}</TableCell>
                        <TableCell className="text-sm">{categoryLabel(t.category)}</TableCell>
                        <TableCell className="text-sm">{t.regulation_citation ?? chapterLabel(t.regulation_chapter)}</TableCell>
                        <TableCell className="text-sm">{recurrenceLabel(t.recurrence, t.custom_interval_days)}</TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" onClick={() => setCopyTemplate(t)}><Copy className="mr-1 h-3.5 w-3.5" />Copy to facilities</Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => openEditor(t, true)}><Pencil className="h-4 w-4" /></Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {templates.length === 0 && <TableRow><TableCell colSpan={canManage ? 5 : 4} className="p-8 text-center text-muted-foreground">No templates yet. Create one to reuse a requirement across facilities.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <RequirementEditorDialog open={editorOpen} onOpenChange={setEditorOpen} requirement={editing} isTemplate={editorTemplate}
        defaultFacilityId={urlState.facility !== "all" ? urlState.facility : ""} />
      <InstanceDetailDialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)} requirementId={detail?.requirementId} instanceId={detail?.instanceId} canManage={canManage} />
      <CopyTemplateDialog open={!!copyTemplate} onOpenChange={(o) => !o && setCopyTemplate(null)} template={copyTemplate} />
    </div>
  );
}
