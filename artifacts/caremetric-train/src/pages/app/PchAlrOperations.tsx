import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, BedDouble, CalendarClock, ClipboardCheck, FileStack, Gavel, Pill, Search, ShieldCheck } from "lucide-react";
import { PCH_ALR_OPERATIONS_ITEMS, buildInspectionDayChecklist, buildPchAlrEvidencePackage, evidencePackageToCsv, evidencePackageToText, searchPchAlrOperations, type OperationsDomain, type PchAlrOperationsItem } from "@/lib/pchAlrOperations";
import { buildPchAlrOperationsQueue, summarizePchAlrQueue } from "@/lib/pchAlrOperationalSnapshot";
import { useAuth } from "@/lib/auth";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListTrainingRecords } from "@/hooks/useTrainingRecords";
import { useListEmployeeCredentials } from "@/hooks/useEmployeeCredentials";
import { useListAllResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
import { useListIncidents } from "@/hooks/useIncidents";
import { useListCorrectiveActions } from "@/hooks/useCorrectiveActions";
import { useListPolicyAttestations } from "@/hooks/usePolicyAttestations";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const DOMAIN_ICONS: Record<OperationsDomain, typeof Gavel> = {
  "Regulatory crosswalk": Gavel,
  "Move-in readiness": BedDouble,
  "Medication safety": Pill,
  "Administrator qualification": ShieldCheck,
  "Special care": BedDouble,
  "Inspection day": ClipboardCheck,
  "Resident rights": AlertTriangle,
  "Emergency preparedness": CalendarClock,
  "Daily operations": CalendarClock,
  "Citation-aware templates": FileStack,
};

export default function PchAlrOperations() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const filtered = useMemo(() => searchPchAlrOperations(query), [query]);
  const inspectionChecklist = useMemo(() => buildInspectionDayChecklist(), []);
  const pchCount = PCH_ALR_OPERATIONS_ITEMS.filter((item) => item.programs.includes("PCH")).length;
  const alrCount = PCH_ALR_OPERATIONS_ITEMS.filter((item) => item.programs.includes("ALR")).length;

  const { data: facilities } = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const activeFacilityId = facilityId || facilities?.[0]?.id || "";
  const { data: trainingRecords } = useListTrainingRecords({ facilityId: activeFacilityId || undefined }, { enabled: Boolean(activeFacilityId) });
  const { data: credentials } = useListEmployeeCredentials({ facilityId: activeFacilityId || undefined });
  const { data: residentItems } = useListAllResidentComplianceItems({ facilityId: activeFacilityId || undefined });
  const { data: incidents } = useListIncidents({ facilityId: activeFacilityId || undefined });
  const { data: correctiveActions } = useListCorrectiveActions({ facilityId: activeFacilityId || undefined });
  const { data: policyAttestations } = useListPolicyAttestations({});
  const operationsQueue = useMemo(() => buildPchAlrOperationsQueue({
    today: toLocalIsoDate(),
    trainingRecords,
    credentials,
    residentItems,
    incidents,
    correctiveActions,
    policyAttestations: (policyAttestations ?? []).filter((attestation) => !activeFacilityId || attestation.facility_id === activeFacilityId),
  }), [trainingRecords, credentials, residentItems, incidents, correctiveActions, policyAttestations, activeFacilityId]);
  const queueSummary = useMemo(() => summarizePchAlrQueue(operationsQueue), [operationsQueue]);
  const activeFacilityName = facilities?.find((facility) => facility.id === activeFacilityId)?.name ?? "Selected facility";
  const evidencePackage = useMemo(() => buildPchAlrEvidencePackage({
    facilityName: activeFacilityName,
    asOfDate: toLocalIsoDate(),
    queue: operationsQueue,
  }), [activeFacilityName, operationsQueue]);

  const copyEvidencePackage = async () => {
    try {
      await navigator.clipboard.writeText(evidencePackageToText(evidencePackage));
      toast({ title: "Evidence package copied" });
    } catch (error) {
      toast({ title: "Unable to copy package", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const downloadEvidencePackageCsv = () => {
    const blob = new Blob([evidencePackageToCsv(evidencePackage)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pch-alr-evidence-package-${toLocalIsoDate()}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight">PCH / ALF Operations Center</h1>
          <p className="text-muted-foreground">
            A survey-focused control room for Pennsylvania personal care homes and assisted living facilities (ALF). It ties Chapter 2600/2800 citation areas to the app workflows that hold evidence, owners, cadence, and inspection-day prompts.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/inspection-readiness">Open inspection readiness</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Metric title="Operational playbooks" value={PCH_ALR_OPERATIONS_ITEMS.length} detail="Cross-module PCH/ALF controls" />
        <Metric title="PCH applicable" value={pchCount} detail="Chapter 2600-oriented controls" />
        <Metric title="ALF applicable" value={alrCount} detail="Chapter 2800-oriented controls" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>72-hour live operations queue</CardTitle>
              <CardDescription>Facility-scoped gaps pulled from training, credentials, resident state forms, incidents, corrective actions, and policy attestations.</CardDescription>
            </div>
            <Select value={activeFacilityId} onValueChange={setFacilityId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select facility" /></SelectTrigger>
              <SelectContent>
                {(facilities ?? []).map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Metric title="Open queue items" value={queueSummary.totalOpen} detail="Across active PCH/ALF workflows" />
            <Metric title="Attention buckets" value={queueSummary.attentionCount} detail="Workflow groups with open risk" />
            <Metric title="Ready buckets" value={queueSummary.readyCount} detail="No open records in this view" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {operationsQueue.map((item) => (
              <div key={item.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.guidance}</p>
                  </div>
                  <Badge variant={item.count > 0 ? "destructive" : "outline"}>{item.count}</Badge>
                </div>
                <Button asChild variant="link" size="sm" className="mt-2 h-auto p-0"><Link href={item.route}>Open queue workflow</Link></Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Find a compliance workflow</CardTitle>
          <CardDescription>Search by citation, module, survey prompt, owner, or facility program.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search medication, 2800.64, rights, emergency, binder..." className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="playbooks">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="playbooks">Playbooks</TabsTrigger>
          <TabsTrigger value="inspection-day">Inspection day</TabsTrigger>
          <TabsTrigger value="evidence-package">Evidence package</TabsTrigger>
        </TabsList>
        <TabsContent value="playbooks" className="mt-4">
          <div className="grid gap-4 xl:grid-cols-2">
            {filtered.map((item) => <OperationsCard key={item.id} item={item} />)}
          </div>
          {filtered.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No PCH/ALF workflows match that search.</p> : null}
        </TabsContent>
        <TabsContent value="inspection-day" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Surveyor request checklist</CardTitle>
              <CardDescription>Use these prompts to build an entrance packet or evidence-room collection before state walks in.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-3 pl-5 text-sm">
                {inspectionChecklist.map((item) => <li key={item}>{item}</li>)}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="evidence-package" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>As-of evidence package outline</CardTitle>
                  <CardDescription>Export a survey handoff index that pairs citation prompts with evidence sources and open queue counts.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={copyEvidencePackage}>Copy package</Button>
                  <Button variant="outline" size="sm" onClick={downloadEvidencePackageCsv}>Download CSV</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {evidencePackage.map((section) => (
                <div key={section.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{section.heading}</p>
                      <p className="text-xs text-muted-foreground">{section.surveyPrompt}</p>
                    </div>
                    <Badge variant={section.openQueueCount > 0 ? "destructive" : "outline"}>{section.openQueueCount} open</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {section.citations.map((citation) => <Badge key={citation} variant="secondary" className="text-[10px]">{citation}</Badge>)}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Evidence: {section.evidenceSources.join(" · ")}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ title, value, detail }: { title: string; value: number; detail: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent><p className="text-3xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{detail}</p></CardContent>
    </Card>
  );
}

function OperationsCard({ item }: { item: PchAlrOperationsItem }) {
  const Icon = DOMAIN_ICONS[item.domain];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><Icon className="h-5 w-5 text-primary" /> {item.title}</CardTitle>
            <CardDescription className="mt-1">{item.summary}</CardDescription>
          </div>
          <div className="flex gap-1">{item.programs.map((program) => <Badge key={program} variant="outline">{program}</Badge>)}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">{item.citations.map((citation) => <Badge key={citation} variant="secondary">{citation}</Badge>)}</div>
        <dl className="grid gap-3 md:grid-cols-2">
          <div><dt className="font-medium">Owner</dt><dd className="text-muted-foreground">{item.owner}</dd></div>
          <div><dt className="font-medium">Cadence</dt><dd className="text-muted-foreground">{item.cadence}</dd></div>
          <div className="md:col-span-2"><dt className="font-medium">Survey prompt</dt><dd className="text-muted-foreground">{item.surveyPrompt}</dd></div>
          <div className="md:col-span-2"><dt className="font-medium">Evidence sources</dt><dd className="text-muted-foreground">{item.evidenceSources.join(" · ")}</dd></div>
        </dl>
        <Button asChild variant="outline" size="sm"><Link href={item.route}>Open owning workflow</Link></Button>
      </CardContent>
    </Card>
  );
}
