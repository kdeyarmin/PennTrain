import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListTrainingRecords } from "@/hooks/useTrainingRecords";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useListEmployeeCredentials } from "@/hooks/useEmployeeCredentials";
import { useListInspectionItems } from "@/hooks/useInspectionItems";
import { useListIncidents } from "@/hooks/useIncidents";
import { useListCorrectiveActions } from "@/hooks/useCorrectiveActions";
import { useListPolicyAttestations } from "@/hooks/usePolicyAttestations";
import { useListAdministratorProfiles } from "@/hooks/useAdministratorProfiles";
import { useListResidents } from "@/hooks/useResidents";
import { useListFacilityUnits } from "@/hooks/useFacilityUnits";
import { useListEmployeeSchedulePreferences } from "@/hooks/useEmployeeSchedulePreferences";
import { useFacilityReadinessBreakdown } from "@/hooks/useCitationTopics";
import { useListEntranceConferenceItems, type EntranceConferenceItem } from "@/hooks/useEntranceConferenceItems";
import { BinderExportButton } from "@/components/reports/BinderExportButton";
import { buildInspectionReadinessActions, type ReadinessActionChecklistItem } from "@/lib/inspectionReadiness";
import { buildRemediationPlanDraft, remediationPlanToText } from "@/lib/remediationPlan";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ClipboardCheck, Copy, Download, FileArchive, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { buildAdministratorRulePack, summarizeAdministratorRulePack } from "@/lib/administratorRulePacks";
import { buildSpecialCareComplianceSummary } from "@/lib/specialCareCompliance";
import { supabase } from "@/lib/supabase";

const BACKGROUND_CHECK_CREDENTIAL_TYPES = ["act34_criminal_history", "act73_fbi_fingerprint", "act33_child_abuse"];
const HEALTH_CREDENTIAL_TYPES = ["tb_screening", "immunization"];

type ReadinessLevel = "ready" | "attention" | "unknown";

function ReadinessChip({ level, detail }: { level: ReadinessLevel; detail?: string }) {
  if (level === "ready") {
    return <Badge className="bg-success text-success-foreground hover:bg-success/80">Ready{detail ? ` -- ${detail}` : ""}</Badge>;
  }
  if (level === "attention") {
    return <Badge variant="destructive">Attention Needed{detail ? ` -- ${detail}` : ""}</Badge>;
  }
  return <Badge variant="outline">Review Manually</Badge>;
}

function scoreColor(pct: number) {
  if (pct >= 90) return "text-success";
  if (pct >= 75) return "text-warning";
  return "text-destructive";
}

export default function InspectionReadiness() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [facilityId, setFacilityId] = useState<string>("");
  const [showDraftPlan, setShowDraftPlan] = useState(false);
  const [mockInspectionRunning, setMockInspectionRunning] = useState(false);
  const [mockInspectionRunId, setMockInspectionRunId] = useState<string | null>(null);
  const [mockInspectionSummary, setMockInspectionSummary] = useState<{ passed: number; attention: number; indeterminate: number } | null>(null);

  const { data: facilities } = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const activeFacilityId = facilityId || facilities?.[0]?.id || "";

  const { data: breakdown, isLoading: breakdownLoading } = useFacilityReadinessBreakdown(activeFacilityId || undefined);
  const { data: checklistItems } = useListEntranceConferenceItems();

  const { data: employees } = useListEmployees({ facilityId: activeFacilityId || undefined, status: "active" });
  const { data: trainingRecords } = useListTrainingRecords({ facilityId: activeFacilityId || undefined });
  const { data: trainingTypes } = useListTrainingTypes();
  const { data: credentials } = useListEmployeeCredentials({ facilityId: activeFacilityId || undefined });
  const { data: inspectionItems } = useListInspectionItems({ facilityId: activeFacilityId || undefined, isActive: true });
  const { data: incidents } = useListIncidents({ facilityId: activeFacilityId || undefined });
  const { data: correctiveActions } = useListCorrectiveActions({ facilityId: activeFacilityId || undefined });
  const { data: policyAttestations } = useListPolicyAttestations({});
  const { data: administratorProfiles } = useListAdministratorProfiles(user?.organizationId ?? undefined);
  const { data: residents } = useListResidents({ facilityId: activeFacilityId || undefined });
  const { data: units } = useListFacilityUnits({ facilityId: activeFacilityId || undefined });
  const { data: schedulePreferences } = useListEmployeeSchedulePreferences({ facilityId: activeFacilityId || undefined });


  const overall = useMemo(() => {
    if (!breakdown) return null;
    let weightedCompliant = 0;
    let weightedTotal = 0;
    for (const row of breakdown) {
      if (row.total_count === 0) continue;
      weightedCompliant += row.frequency_weight * row.compliant_count;
      weightedTotal += row.frequency_weight * row.total_count;
    }
    if (weightedTotal === 0) return null;
    return Math.round((weightedCompliant / weightedTotal) * 100);
  }, [breakdown]);

  const sortedBreakdown = useMemo(() => {
    if (!breakdown) return [];
    return [...breakdown]
      .filter((row) => row.total_count > 0)
      .sort((a, b) => a.compliant_count / a.total_count - b.compliant_count / b.total_count);
  }, [breakdown]);

  const today = toLocalIsoDate();
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const activeFacility = facilities?.find((facility) => facility.id === activeFacilityId);
  const specialCareSummary = useMemo(() => buildSpecialCareComplianceSummary({
    units: units ?? [],
    residents: residents ?? [],
    schedulePreferences: schedulePreferences ?? [],
    trainingRecords: trainingRecords ?? [],
    trainingTypes: trainingTypes ?? [],
  }), [units, residents, schedulePreferences, trainingRecords, trainingTypes]);

  function readinessFor(item: EntranceConferenceItem): { level: ReadinessLevel; detail?: string } {
    switch (item.data_source) {
      case "roster": {
        const count = employees?.length ?? 0;
        return count > 0 ? { level: "ready", detail: `${count} active` } : { level: "attention", detail: "no active staff on file" };
      }
      case "training": {
        const rows = trainingRecords ?? [];
        const outstanding = rows.filter((r) => r.status === "expired" || r.status === "due_soon" || r.status === "missing");
        return outstanding.length === 0
          ? { level: "ready" }
          : { level: "attention", detail: `${outstanding.length} outstanding` };
      }
      case "credentials": {
        const rows = (credentials ?? []).filter((c) => HEALTH_CREDENTIAL_TYPES.includes(c.credential_type));
        const outstanding = rows.filter((c) => c.status === "expired" || c.status === "due_soon" || c.status === "missing");
        return outstanding.length === 0
          ? { level: "ready" }
          : { level: "attention", detail: `${outstanding.length} outstanding` };
      }
      case "background_checks": {
        const rows = (credentials ?? []).filter((c) => BACKGROUND_CHECK_CREDENTIAL_TYPES.includes(c.credential_type));
        const outstanding = rows.filter((c) => c.status === "expired" || c.status === "due_soon" || c.status === "missing");
        return outstanding.length === 0
          ? { level: "ready" }
          : { level: "attention", detail: `${outstanding.length} outstanding` };
      }
      case "inspections": {
        const rows = inspectionItems ?? [];
        const outstanding = rows.filter((i) => i.status === "expired" || i.status === "due_soon" || i.status === "missing");
        return outstanding.length === 0
          ? { level: "ready" }
          : { level: "attention", detail: `${outstanding.length} outstanding` };
      }
      case "incidents": {
        const openIncidents = (incidents ?? []).filter(
          (i) => i.occurred_at >= oneYearAgo && !i.final_report_submitted_at
        );
        const overdueActions = (correctiveActions ?? []).filter(
          (a) => a.status !== "completed" && a.due_date < today
        );
        const outstanding = openIncidents.length + overdueActions.length;
        return outstanding === 0 ? { level: "ready" } : { level: "attention", detail: `${outstanding} outstanding` };
      }
      case "policies": {
        const rows = (policyAttestations ?? []).filter((a) => a.facility_id === activeFacilityId);
        const overdue = rows.filter((a) => a.status === "pending" && a.due_date && a.due_date < today);
        return overdue.length === 0 ? { level: "ready" } : { level: "attention", detail: `${overdue.length} overdue` };
      }
      case "administrator": {
        if (!activeFacility || !(activeFacility.facility_type === "PCH" || activeFacility.facility_type === "ALR")) {
          return { level: "unknown", detail: "not a PCH/ALF facility" };
        }
        const rulePack = buildAdministratorRulePack(activeFacility.facility_type, {
          profile: (administratorProfiles ?? [])[0] ?? null,
          ceEntries: [],
          today,
        });
        const summary = summarizeAdministratorRulePack(rulePack);
        return summary.ready
          ? { level: "ready", detail: `${summary.total} rule-pack items ready` }
          : { level: "attention", detail: `${summary.blockingCount} administrator blocker(s)` };
      }
      default:
        return { level: "unknown" };
    }
  }

  const checklistReadiness = useMemo<ReadinessActionChecklistItem[]>(() =>
    (checklistItems ?? []).map((item) => {
      const result = readinessFor(item);
      return {
        id: item.id,
        category: item.category,
        prompt: item.prompt,
        level: result.level,
        detail: result.detail,
      };
    }),
    [checklistItems, employees, trainingRecords, credentials, inspectionItems, incidents, correctiveActions, policyAttestations, administratorProfiles, activeFacility, activeFacilityId, oneYearAgo, today],
  );

  const actionQueue = useMemo(() => buildInspectionReadinessActions({
    topics: (breakdown ?? []).map((row) => ({
      id: row.citation_topic_id,
      title: row.title,
      citationRef: row.citation_ref,
      compliantCount: row.compliant_count,
      totalCount: row.total_count,
      frequencyWeight: row.frequency_weight,
    })),
    checklistItems: checklistReadiness,
  }), [breakdown, checklistReadiness]);

  const remediationDraft = useMemo(() => buildRemediationPlanDraft(actionQueue), [actionQueue]);
  const remediationDraftText = useMemo(() => remediationPlanToText(remediationDraft), [remediationDraft]);

  const handleCopyDraftPlan = async () => {
    try {
      await navigator.clipboard.writeText(remediationDraftText);
      toast({ title: "Draft remediation plan copied" });
    } catch (err) {
      toast({ title: "Failed to copy draft", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const handleRunMockInspection = async () => {
    if (!activeFacilityId) return;
    setMockInspectionRunning(true);
    setMockInspectionRunId(null);
    void supabase.functions.invoke("capture-product-event", { body: { eventName: "mock_inspection_started", route: "/app/inspection-readiness", properties: { surface: "inspection_readiness" } } });
    try {
      const { data, error } = await supabase.functions.invoke("run-mock-inspection", {
        body: { facilityId: activeFacilityId, asOfDate: today },
      });
      if (error) throw error;
      setMockInspectionRunId(data.runId);
      setMockInspectionSummary({ passed: data.passed, attention: data.attention, indeterminate: data.indeterminate });
      void supabase.functions.invoke("capture-product-event", { body: { eventName: "mock_inspection_completed", route: "/app/inspection-readiness", properties: { result: data.attention > 0 ? "attention" : "ready", count: data.attention, surface: "inspection_readiness" } } });
      toast({ title: "Mock inspection completed", description: `${data.attention} attention item(s), ${data.indeterminate} manual review item(s).` });
    } catch (error) {
      toast({ title: "Mock inspection failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally { setMockInspectionRunning(false); }
  };

  const handleDownloadMockInspection = async () => {
    if (!mockInspectionRunId) return;
    try {
      const { data, error } = await supabase.functions.invoke("generate-mock-inspection-report", { body: { runId: mockInspectionRunId } });
      if (error) throw error;
      const blob = data instanceof Blob ? data : new Blob([data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `mock-inspection-${today}.pdf`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      toast({ title: "Gap report download failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const groupedChecklist = useMemo(() => {
    const groups = new Map<string, EntranceConferenceItem[]>();
    for (const item of checklistItems ?? []) {
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return Array.from(groups.entries());
  }, [checklistItems]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inspection Readiness</h1>
          <p className="text-muted-foreground">
            A live, per-facility readiness score by DHS citation topic, plus a mock entrance-conference walkthrough.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={activeFacilityId} onValueChange={setFacilityId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select facility" /></SelectTrigger>
            <SelectContent>{(facilities ?? []).map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button asChild variant="outline">
            <Link href={`/app/survey-day?facility=${activeFacilityId}`}><ClipboardCheck className="mr-2 h-4 w-4" />Start Survey Day</Link>
          </Button>
          <Button onClick={() => void handleRunMockInspection()} disabled={!activeFacilityId || mockInspectionRunning}>
            {mockInspectionRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {mockInspectionRunning ? "Running grounded checks..." : "Run mock inspection"}
          </Button>
          {mockInspectionRunId ? <Button variant="outline" onClick={() => void handleDownloadMockInspection()}><Download className="mr-2 h-4 w-4" /> Gap report PDF</Button> : null}
        </div>
      </div>

      {mockInspectionSummary ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          Latest mock inspection: <strong>{mockInspectionSummary.passed} pass</strong>, <strong>{mockInspectionSummary.attention} attention</strong>, and <strong>{mockInspectionSummary.indeterminate} manual review</strong>. Each result retains its governed source and row documentation IDs.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Citation-Weighted Readiness Score
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {breakdownLoading ? (
            <div className="h-16 bg-muted animate-pulse rounded-lg" />
          ) : overall === null ? (
            <p className="text-sm text-muted-foreground">No compliance data yet for this facility.</p>
          ) : (
            <div className={`text-4xl font-bold ${scoreColor(overall)}`}>{overall}%</div>
          )}
          <p className="text-xs text-muted-foreground">
            Weighted by a default per-topic planning weight (not a live BHSL citation-frequency feed -- see the
            weight column below). Worst-performing topics are listed first.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-4">Topic</th>
                  <th className="py-2 pr-4">Chapter / Citation</th>
                  <th className="py-2 pr-4">Weight</th>
                  <th className="py-2 pr-4">Compliant</th>
                  <th className="py-2 pr-4">%</th>
                </tr>
              </thead>
              <tbody>
                {sortedBreakdown.map((row) => {
                  const pct = Math.round((row.compliant_count / row.total_count) * 100);
                  return (
                    <tr key={row.citation_topic_id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{row.title}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {row.chapter === "both" ? "2600 / 2800" : row.chapter}
                        {row.citation_ref ? ` (${row.citation_ref})` : ""}
                      </td>
                      <td className="py-2 pr-4">{row.frequency_weight}x</td>
                      <td className="py-2 pr-4">
                        {row.compliant_count} / {row.total_count}
                      </td>
                      <td className={`py-2 pr-4 font-medium ${scoreColor(pct)}`}>{pct}%</td>
                    </tr>
                  );
                })}
                {sortedBreakdown.length === 0 && !breakdownLoading && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">
                      No tagged compliance records for this facility yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {activeFacility && (activeFacility.facility_type === "PCH" || activeFacility.facility_type === "ALR") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              Dementia / Special-Care Designation Gaps
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div>
              <p className="text-2xl font-bold">{specialCareSummary.designatedUnits.length}</p>
              <p className="text-xs text-muted-foreground">designated unit(s)</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{specialCareSummary.residentPlacements}</p>
              <p className="text-xs text-muted-foreground">resident placement(s)</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{specialCareSummary.staffingGapCount}</p>
              <p className="text-xs text-muted-foreground">training/staffing gap(s)</p>
            </div>
            <div>
              <Badge variant={specialCareSummary.status === "needs_attention" ? "destructive" : "outline"} className="capitalize">
                {specialCareSummary.status.replaceAll("_", " ")}
              </Badge>
              <p className="mt-2 text-xs text-muted-foreground">
                Uses unit designation, SDCU resident placement, schedule preferences, and dementia/special-care training records.
              </p>
            </div>
          </CardContent>
        </Card>
      )}


      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> Readiness Action Queue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Prioritized gaps from the citation-weighted score and entrance-conference checklist. Work from the top down before generating the packet.
          </p>
          {actionQueue.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              No prioritized readiness gaps found for this facility.
            </div>
          ) : (
            <div className="space-y-2">
              {actionQueue.map((action) => (
                <div key={action.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{action.title}</p>
                    <p className="text-xs text-muted-foreground">{action.detail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={action.kind === "citation_topic" ? "secondary" : "outline"}>
                      {action.kind === "citation_topic" ? "Citation topic" : "Entrance item"}
                    </Badge>
                    <Badge variant={action.severity === "critical" ? "destructive" : "outline"}>
                      {action.severity}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>


      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> Draft Remediation Plan
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowDraftPlan((v) => !v)}>
                {showDraftPlan ? "Hide Draft" : "Build Draft"}
              </Button>
              {showDraftPlan && (
                <Button variant="outline" size="sm" onClick={handleCopyDraftPlan}>
                  <Copy className="mr-2 h-4 w-4" /> Copy
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Creates a human-review draft from the current action queue so managers can assign owners, due dates, and documentation requests without starting from a blank page.
          </p>
          {showDraftPlan && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-medium">{remediationDraft.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">{remediationDraft.reviewerNote}</p>
              </div>
              <div className="space-y-2">
                {remediationDraft.steps.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No remediation steps are needed from the current queue.</p>
                ) : remediationDraft.steps.map((step) => (
                  <div key={`${step.title}-${step.owner}`} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{step.title}</p>
                      <Badge variant="outline">Due in {step.dueInDays} days</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Owner: {step.owner}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Documentation: {step.evidence}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Mock Entrance Conference Checklist
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Modeled on general PA DHS entrance-conference practice for personal care homes / assisted living
            residences -- not a verbatim reproduction of the current DHS Entrance Conference Guide. Keep your own
            copy on hand and compare item wording before a real inspection.
          </p>
          {groupedChecklist.map(([category, items]) => (
            <div key={category} className="space-y-2">
              <h3 className="text-sm font-semibold">{category}</h3>
              <div className="space-y-2">
                {items.map((item) => {
                  const result = readinessFor(item);
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <span className="text-sm">{item.prompt}</span>
                      <ReadinessChip level={result.level} detail={result.detail} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Entrance Conference Packet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            One-click packet covering facilities, staff requirements, credentials, incidents, and inspection items --
            generated fresh from current data.
          </p>
          <BinderExportButton label="Generate Entrance Packet" />
        </CardContent>
      </Card>
    </div>
  );
}
