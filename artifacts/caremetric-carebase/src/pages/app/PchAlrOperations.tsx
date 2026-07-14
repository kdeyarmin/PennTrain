import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, BedDouble, Building2, CalendarClock, ChevronRight, ClipboardCheck, FileStack, Gavel, Pill, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { PCH_ALR_OPERATIONS_ITEMS, buildInspectionDayChecklist, buildPchAlrEvidencePackage, evidencePackageToCsv, evidencePackageToText, searchPchAlrOperations, type OperationsDomain, type PchAlrOperationsItem } from "@/lib/pchAlrOperations";
import { buildPchAlrOperationsQueueFromSnapshot, summarizePchAlrQueue } from "@/lib/pchAlrOperationalSnapshot";
import { useAuth } from "@/lib/auth";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { facilityTypeLabel, PCH_ALR_ONLY_FACILITY_TYPES } from "@/lib/facilityTypes";
import { useListFacilities } from "@/hooks/useFacilities";
import { useOperationsCommandCenter, usePortfolioOperationsCommandCenter, type PortfolioReadinessStatus } from "@/hooks/useOperationsCommandCenter";
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

const SOURCE_ROUTES: Record<string, string> = {
  complaint: "/app/complaints",
  credential: "/app/credentials",
  dietary_exception: "/app/dietary-operations",
  food_safety: "/app/dietary-operations",
  incident: "/app/incidents",
  inspection: "/app/inspections",
  policy: "/app/policy-documents",
  qapi: "/app/qapi",
  resident_calendar: "/app/resident-services-calendar",
  resident_finance: "/app/resident-finance",
  support_plan: "/app/services",
  training_gap: "/app/training-matrix",
  violation: "/app/violations",
};

function sourceLabel(sourceType: string): string {
  if (sourceType === "qapi") return "QAPI";
  return sourceType.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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
  const eligibleFacilities = useMemo(
    () => (facilities ?? []).filter((facility) => facility.facility_type === "PCH" || facility.facility_type === "ALR"),
    [facilities],
  );
  const activeFacilityId = facilityId || eligibleFacilities[0]?.id || "";
  const { data: snapshot, error: snapshotError, isFetching, refetch } = useOperationsCommandCenter(activeFacilityId || undefined);
  const {
    data: portfolioSnapshot,
    error: portfolioError,
    isFetching: isPortfolioFetching,
    refetch: refetchPortfolio,
  } = usePortfolioOperationsCommandCenter();
  const operationsQueue = useMemo(
    () => snapshot ? buildPchAlrOperationsQueueFromSnapshot(snapshot.signals, snapshot.workQueue) : [],
    [snapshot],
  );
  const queueSummary = useMemo(() => summarizePchAlrQueue(operationsQueue), [operationsQueue]);
  const activeFacilityName = snapshot?.facility.name ?? facilities?.find((facility) => facility.id === activeFacilityId)?.name ?? "Selected facility";
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

  const openFacilityHuddle = (nextFacilityId: string) => {
    setFacilityId(nextFacilityId);
    window.requestAnimationFrame(() => document.getElementById("facility-huddle")?.scrollIntoView({ behavior: "smooth", block: "start" }));
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
              <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> Portfolio operations oversight</CardTitle>
              <CardDescription>Rank every caller-visible PCH and ALF facility by immediate operational risk, then open the facility huddle that needs action.</CardDescription>
            </div>
            <Button variant="outline" size="sm" disabled={isPortfolioFetching} onClick={() => void refetchPortfolio()}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isPortfolioFetching ? "animate-spin" : ""}`} /> Refresh portfolio
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {portfolioError ? <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{portfolioError.message}</div> : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric title="Facilities in scope" value={portfolioSnapshot?.summary.facilityCount ?? 0} detail={`${portfolioSnapshot?.summary.activeResidents ?? 0} active residents`} />
            <Metric title="Critical facilities" value={portfolioSnapshot?.summary.criticalFacilities ?? 0} detail="Emergency, urgent, or high-risk signals" />
            <Metric title="Open work" value={portfolioSnapshot?.summary.openWork ?? 0} detail={`${portfolioSnapshot?.summary.urgentWork ?? 0} urgent · ${portfolioSnapshot?.summary.overdueWork ?? 0} overdue`} />
            <Metric title="Readiness gaps" value={(portfolioSnapshot?.summary.residentReadinessGaps ?? 0) + (portfolioSnapshot?.summary.workforceGaps ?? 0)} detail="Resident and workforce requirements" />
          </div>
          {portfolioSnapshot?.facilities.length === 0 ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">No active PCH or ALF facilities are available in your assigned scope.</p>
          ) : (
            <div className="space-y-2">
              {portfolioSnapshot?.facilities.map((facility) => (
                <div key={facility.facility.id} className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,0.65fr))_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold">{facility.facility.name}</p>
                      <Badge variant={portfolioStatusVariant(facility.readinessStatus)}>{portfolioStatusLabel(facility.readinessStatus)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{facilityTypeLabel(facility.facility.facilityType)} · risk score {facility.riskScore}</p>
                  </div>
                  <PortfolioSignal label="Open work" value={facility.workQueue.openCount} detail={`${facility.workQueue.urgentCount} urgent`} />
                  <PortfolioSignal label="Overdue" value={facility.workQueue.overdueCount} detail={`${facility.workQueue.unassignedCount} unassigned`} />
                  <PortfolioSignal label="Resident gaps" value={facility.signals.residentReadinessGaps} detail={`${facility.signals.activeResidents} residents`} />
                  <PortfolioSignal label="Safety signals" value={facility.signals.activeEmergencyEvents + facility.signals.highRiskWorkOrders} detail={`${facility.signals.emergencyUnaccounted} unaccounted`} />
                  <Button variant="outline" size="sm" onClick={() => openFacilityHuddle(facility.facility.id)}>
                    Open huddle <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {portfolioSnapshot ? <p className="text-right text-xs text-muted-foreground">Updated {new Date(portfolioSnapshot.generatedAt).toLocaleString()}</p> : null}
        </CardContent>
      </Card>

      <Card id="facility-huddle" className="scroll-mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>72-hour live operations queue</CardTitle>
              <CardDescription>One RLS-scoped snapshot across workforce, resident readiness, rights, emergencies, maintenance, and owned corrective work.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!activeFacilityId || isFetching} onClick={() => void refetch()}>
                <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Select value={activeFacilityId} onValueChange={setFacilityId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Select facility" /></SelectTrigger>
                <SelectContent>
                  {eligibleFacilities.map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {snapshotError ? <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{snapshotError.message}</div> : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric title="Owned work open" value={snapshot?.workQueue.openCount ?? 0} detail={`${snapshot?.workQueue.urgentCount ?? 0} urgent · ${snapshot?.workQueue.overdueCount ?? 0} overdue`} />
            <Metric title="Attention buckets" value={queueSummary.attentionCount} detail="Workflow groups with open risk" />
            <Metric title="Ready buckets" value={queueSummary.readyCount} detail="No open records in this view" />
            <Metric title="Active residents" value={snapshot?.signals.activeResidents ?? 0} detail="Current facility census in scope" />
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
          {snapshot ? (
            <div className="grid gap-4 border-t pt-4 xl:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">Priority attention</p>
                    <p className="text-xs text-muted-foreground">Urgent, overdue, then unassigned work—ordered for the next huddle.</p>
                  </div>
                  <Button asChild variant="outline" size="sm"><Link href="/app/work">Open all work</Link></Button>
                </div>
                {snapshot.attentionItems.length === 0 ? <p className="rounded-lg border p-3 text-sm text-muted-foreground">No owned work is open for this facility.</p> : snapshot.attentionItems.slice(0, 6).map((item) => (
                  <Link key={item.id} href={`/app/work/${item.id}`} className="flex items-start justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{sourceLabel(item.sourceType)} · due {new Date(item.dueAt).toLocaleString()}</p>
                    </div>
                    <Badge variant={item.priority === "urgent" || new Date(item.dueAt).getTime() < Date.now() ? "destructive" : "outline"}>{item.priority}</Badge>
                  </Link>
                ))}
              </div>
              <div className="space-y-2">
                <div>
                  <p className="font-semibold">Open work by source</p>
                  <p className="text-xs text-muted-foreground">Every current and future module appears automatically through the shared work queue.</p>
                </div>
                {snapshot.sourceBreakdown.length === 0 ? <p className="rounded-lg border p-3 text-sm text-muted-foreground">No source queues are open.</p> : snapshot.sourceBreakdown.map((source) => (
                  <div key={source.sourceType} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{sourceLabel(source.sourceType)}</p>
                      <p className="text-xs text-muted-foreground">{source.urgentCount} urgent · {source.overdueCount} overdue · {source.unassignedCount} unassigned</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={source.overdueCount > 0 || source.urgentCount > 0 ? "destructive" : "secondary"}>{source.openCount}</Badge>
                      <Button asChild variant="ghost" size="sm"><Link href={SOURCE_ROUTES[source.sourceType] ?? "/app/work"}>Open</Link></Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
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

function PortfolioSignal({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function portfolioStatusLabel(status: PortfolioReadinessStatus): string {
  if (status === "critical") return "Critical";
  if (status === "attention") return "Needs attention";
  return "Ready";
}

function portfolioStatusVariant(status: PortfolioReadinessStatus): "destructive" | "secondary" | "outline" {
  if (status === "critical") return "destructive";
  if (status === "attention") return "secondary";
  return "outline";
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
          <div className="flex gap-1">{item.programs.map((program) => <Badge key={program} variant="outline">{program === "ALR" ? "ALF" : program}</Badge>)}</div>
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
