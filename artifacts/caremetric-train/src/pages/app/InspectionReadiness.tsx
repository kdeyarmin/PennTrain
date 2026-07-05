import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListTrainingRecords } from "@/hooks/useTrainingRecords";
import { useListEmployeeCredentials } from "@/hooks/useEmployeeCredentials";
import { useListInspectionItems } from "@/hooks/useInspectionItems";
import { useListIncidents } from "@/hooks/useIncidents";
import { useListCorrectiveActions } from "@/hooks/useCorrectiveActions";
import { useListPolicyAttestations } from "@/hooks/usePolicyAttestations";
import { useListAdministratorProfiles } from "@/hooks/useAdministratorProfiles";
import { useFacilityReadinessBreakdown } from "@/hooks/useCitationTopics";
import { useListEntranceConferenceItems, type EntranceConferenceItem } from "@/hooks/useEntranceConferenceItems";
import { useGenerateComplianceBinder } from "@/hooks/useComplianceBinder";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, Download, FileArchive, Loader2, ShieldAlert } from "lucide-react";

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

  const { data: facilities } = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const activeFacilityId = facilityId || facilities?.[0]?.id || "";

  const { data: breakdown, isLoading: breakdownLoading } = useFacilityReadinessBreakdown(activeFacilityId || undefined);
  const { data: checklistItems } = useListEntranceConferenceItems();

  const { data: employees } = useListEmployees({ facilityId: activeFacilityId || undefined, status: "active" });
  const { data: trainingRecords } = useListTrainingRecords({ facilityId: activeFacilityId || undefined });
  const { data: credentials } = useListEmployeeCredentials({ facilityId: activeFacilityId || undefined });
  const { data: inspectionItems } = useListInspectionItems({ facilityId: activeFacilityId || undefined, isActive: true });
  const { data: incidents } = useListIncidents({ facilityId: activeFacilityId || undefined });
  const { data: correctiveActions } = useListCorrectiveActions({ facilityId: activeFacilityId || undefined });
  const { data: policyAttestations } = useListPolicyAttestations({});
  const { data: administratorProfiles } = useListAdministratorProfiles(user?.organizationId ?? undefined);

  const { mutate: generatePacket, isPending: isGeneratingPacket } = useGenerateComplianceBinder();
  const [packetResult, setPacketResult] = useState<{ url: string; expiresIn: number } | null>(null);

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

  const today = new Date().toISOString().slice(0, 10);
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

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
        const rows = administratorProfiles ?? [];
        const documented = rows.filter(
          (p) => p.hundred_hour_course_completed_date || p.nha_license_number || p.regional_office_verification_submitted_date
        );
        return documented.length > 0
          ? { level: "ready", detail: `${documented.length} on file` }
          : { level: "attention", detail: "no administrator qualification on file" };
      }
      default:
        return { level: "unknown" };
    }
  }

  const groupedChecklist = useMemo(() => {
    const groups = new Map<string, EntranceConferenceItem[]>();
    for (const item of checklistItems ?? []) {
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return Array.from(groups.entries());
  }, [checklistItems]);

  const handleGeneratePacket = () => {
    setPacketResult(null);
    generatePacket(
      {},
      {
        onSuccess: (data) => {
          setPacketResult({ url: data.url, expiresIn: data.expiresIn });
          toast({ title: "Entrance conference packet generated" });
        },
        onError: (err: Error) =>
          toast({ title: "Failed to generate packet", description: err.message, variant: "destructive" }),
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inspection Readiness</h1>
          <p className="text-muted-foreground">
            A live, per-facility readiness score by DHS citation topic, plus a mock entrance-conference walkthrough.
          </p>
        </div>
        <Select value={activeFacilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select facility" />
          </SelectTrigger>
          <SelectContent>
            {(facilities ?? []).map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
            One-click packet covering facilities, staff training, credentials, incidents, and inspection items --
            generated fresh from current data.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleGeneratePacket} disabled={isGeneratingPacket}>
              {isGeneratingPacket ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}
              {isGeneratingPacket ? "Generating..." : "Generate Entrance Packet"}
            </Button>
            {packetResult && (
              <Button variant="outline" asChild>
                <a href={packetResult.url} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </a>
              </Button>
            )}
          </div>
          {packetResult && (
            <p className="text-xs text-muted-foreground">
              This link expires in {Math.round(packetResult.expiresIn / 60)} minutes. Generate a new packet if it expires.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
