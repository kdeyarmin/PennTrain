import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { buildRegulatoryCrosswalkRows, filterRegulatoryCrosswalkRows, type CrosswalkEvidenceSource, type CrosswalkStatus, type FacilityProgram } from "@/lib/regulatoryCrosswalk";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListTrainingRecords } from "@/hooks/useTrainingRecords";
import { useListEmployeeCredentials } from "@/hooks/useEmployeeCredentials";
import { useListAllResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
import { useListIncidents } from "@/hooks/useIncidents";
import { useListCorrectiveActions } from "@/hooks/useCorrectiveActions";
import { useListInspectionItems } from "@/hooks/useInspectionItems";
import { useListViolations } from "@/hooks/useViolations";
import { useListPolicyDocuments } from "@/hooks/usePolicyDocuments";
import { useListPolicyAttestations } from "@/hooks/usePolicyAttestations";
import { useListEvidenceCollections } from "@/hooks/useEvidenceRoom";
import { useActiveRegulatoryRules } from "@/hooks/useRegulatoryRules";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_LABELS: Record<CrosswalkStatus, string> = {
  inspection_ready: "Inspection-ready",
  needs_attention: "Needs attention",
  missing_evidence: "Missing evidence",
  overdue: "Overdue",
};

const SOURCE_LABELS: Record<CrosswalkEvidenceSource, string> = {
  training: "Training / workforce",
  resident: "Resident records",
  incident: "Incidents / medication",
  physical_site: "Physical site",
  policy: "Policies",
  binder: "Binder / evidence room",
};

function statusVariant(status: CrosswalkStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "inspection_ready") return "secondary";
  if (status === "overdue" || status === "missing_evidence") return "destructive";
  return "outline";
}

export default function RegulatoryCrosswalk() {
  const { user } = useAuth();
  const [facilityId, setFacilityId] = useState("");
  const [facilityType, setFacilityType] = useState<FacilityProgram | "all">("all");
  const [status, setStatus] = useState<CrosswalkStatus | "all">("all");
  const [evidenceSource, setEvidenceSource] = useState<CrosswalkEvidenceSource | "all">("all");
  const [citation, setCitation] = useState("");

  const { data: facilities } = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const activeFacilityId = facilityId || facilities?.[0]?.id || "";
  const { data: trainingRecords } = useListTrainingRecords({ facilityId: activeFacilityId || undefined }, { enabled: Boolean(activeFacilityId) });
  const { data: credentials } = useListEmployeeCredentials({ facilityId: activeFacilityId || undefined }, { enabled: Boolean(activeFacilityId) });
  const { data: residentItems } = useListAllResidentComplianceItems({ facilityId: activeFacilityId || undefined });
  const { data: incidents } = useListIncidents({ facilityId: activeFacilityId || undefined });
  const { data: correctiveActions } = useListCorrectiveActions({ facilityId: activeFacilityId || undefined });
  const { data: inspectionItems } = useListInspectionItems({ facilityId: activeFacilityId || undefined });
  const { data: violations } = useListViolations({ facilityId: activeFacilityId || undefined });
  const { data: policyDocuments } = useListPolicyDocuments({ organizationId: user?.organizationId ?? undefined });
  const { data: policyAttestations } = useListPolicyAttestations({});
  const { data: evidenceCollections } = useListEvidenceCollections({ organizationId: user?.organizationId ?? undefined });
  const governedRules = useActiveRegulatoryRules();

  const rows = useMemo(() => buildRegulatoryCrosswalkRows({
    today: toLocalIsoDate(),
    trainingRecords,
    credentials,
    residentItems,
    incidents,
    correctiveActions,
    inspectionItems,
    violations,
    policyDocuments,
    policyAttestations: (policyAttestations ?? []).filter((attestation) => !activeFacilityId || attestation.facility_id === activeFacilityId),
    evidenceCollections: (evidenceCollections ?? []).filter((collection) => !activeFacilityId || collection.facility_id === activeFacilityId),
  }, user?.role, governedRules.data), [trainingRecords, credentials, residentItems, incidents, correctiveActions, inspectionItems, violations, policyDocuments, policyAttestations, evidenceCollections, activeFacilityId, user?.role, governedRules.data]);

  const filteredRows = useMemo(() => filterRegulatoryCrosswalkRows(rows, { facilityType, status, evidenceSource, citation }), [rows, facilityType, status, evidenceSource, citation]);
  const summary = useMemo(() => ({
    ready: rows.filter((row) => row.status === "inspection_ready").length,
    attention: rows.filter((row) => row.status === "needs_attention").length,
    missing: rows.filter((row) => row.status === "missing_evidence").length,
    overdue: rows.filter((row) => row.status === "overdue").length,
  }), [rows]);

  const downloadCsv = () => {
    const header = ["citation", "requirement", "facility_types", "responsible_role", "evidence_source", "status", "next_due_date", "binder_location", "route"];
    const csv = [header, ...filteredRows.map((row) => [
      row.citation,
      row.requirement,
      row.facilityTypes.map((type) => (type === "ALR" ? "ALF" : type)).join("; "),
      row.responsibleRole,
      SOURCE_LABELS[row.evidenceSource],
      STATUS_LABELS[row.status],
      row.nextDueDate ?? "",
      row.binderLocation,
      row.route,
    ])].map((line) => line.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `regulatory-crosswalk-${toLocalIsoDate()}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chapter 2600 / 2800 Regulatory Crosswalk</h1>
          <p className="text-muted-foreground">Citation-by-citation map from PCH/ALF obligations to live CareBase evidence, owners, due dates, and binder destinations.</p>
        </div>
        <Button variant="outline" onClick={downloadCsv}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard title="Inspection-ready" value={summary.ready} icon="ready" />
        <SummaryCard title="Needs attention" value={summary.attention} />
        <SummaryCard title="Missing evidence" value={summary.missing} icon="warning" />
        <SummaryCard title="Overdue" value={summary.overdue} icon="danger" />
      </div>

      <Alert variant={rows.every((row) => row.governedRule) ? "default" : "destructive"}>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Governed rule coverage: {rows.filter((row) => row.governedRule).length} of {rows.length}</AlertTitle>
        <AlertDescription>
          {rows.every((row) => row.governedRule)
            ? "Every crosswalk obligation is backed by an approved, effective, checksum-pinned rule version."
            : "Rows without a governed version are clearly marked reference mappings. They must not be treated as legal advice or activated compliance logic until independent review, fixtures, shadow comparison, and approval are complete."}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Answer “show me proof for this citation” by narrowing facility, program type, citation, status, and evidence source.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <Select value={activeFacilityId} onValueChange={setFacilityId}>
            <SelectTrigger><SelectValue placeholder="Facility" /></SelectTrigger>
            <SelectContent>{(facilities ?? []).map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={facilityType} onValueChange={(value) => setFacilityType(value as FacilityProgram | "all")}>
            <SelectTrigger><SelectValue placeholder="Facility type" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All facility types</SelectItem><SelectItem value="PCH">PCH</SelectItem><SelectItem value="ALR">ALF</SelectItem></SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => setStatus(value as CrosswalkStatus | "all")}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={evidenceSource} onValueChange={(value) => setEvidenceSource(value as CrosswalkEvidenceSource | "all")}>
            <SelectTrigger><SelectValue placeholder="Evidence source" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All sources</SelectItem>{Object.entries(SOURCE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={citation} onChange={(event) => setCitation(event.target.value)} placeholder="Citation or requirement" />
        </CardContent>
      </Card>

      <div className="space-y-3">
        {filteredRows.map((row) => (
          <Card key={row.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{row.citation}</Badge>
                    {row.facilityTypes.map((type) => <Badge key={type} variant="secondary">{type === "ALR" ? "ALF" : type}</Badge>)}
                    <Badge variant={statusVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
                    <Badge variant={row.governedRule ? "default" : "outline"}>{row.governedRule ? `Governed v${row.governedRule.version_number}` : "Reference mapping"}</Badge>
                  </div>
                  <CardTitle className="text-lg">{row.requirement}</CardTitle>
                  <CardDescription>{row.evidenceLabel}</CardDescription>
                </div>
                <Button asChild variant="outline" size="sm"><Link href={row.route}>Open evidence <ExternalLink className="ml-2 h-3.5 w-3.5" /></Link></Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-4">
              <div><p className="font-medium">Responsible role</p><p className="text-muted-foreground">{row.responsibleRole}</p></div>
              <div><p className="font-medium">Evidence source</p><p className="text-muted-foreground">{SOURCE_LABELS[row.evidenceSource]}</p></div>
              <div><p className="font-medium">Next due date</p><p className="text-muted-foreground">{row.nextDueDate ?? "No dated evidence"}</p></div>
              <div><p className="font-medium">Binder location</p><p className="text-muted-foreground">{row.binderLocation}</p></div>
              <div className="md:col-span-4 rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
                {row.evidenceCount} evidence row{row.evidenceCount === 1 ? "" : "s"} · {row.gapCount} open gap{row.gapCount === 1 ? "" : "s"} · {row.canEdit ? "Managers can update linked evidence." : "Auditor access is read-only."}
                {row.governedRule ? <span className="mt-1 block">Effective {row.governedRule.effective_from} · content checksum {row.governedRule.content_checksum_sha256.slice(0, 16)}...{row.governedRule.source_uri ? <> · <a href={row.governedRule.source_uri} target="_blank" rel="noreferrer" className="text-primary hover:underline">Official source</a></> : null}</span> : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ title, value, icon }: { title: string; value: number; icon?: "ready" | "warning" | "danger" }) {
  const Icon = icon === "ready" ? CheckCircle2 : icon === "danger" ? ShieldAlert : AlertTriangle;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Icon className="h-4 w-4" />{title}</CardTitle></CardHeader>
      <CardContent><p className="text-3xl font-bold">{value}</p></CardContent>
    </Card>
  );
}
