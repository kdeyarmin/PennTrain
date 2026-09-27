import { useMemo, useState } from "react";

import { Link } from "wouter";
import { Activity, AlertTriangle, ClipboardCheck, HeartPulse, Hospital, RefreshCw, Stethoscope } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListResidents } from "@/hooks/useResidents";
import { useResidentNavigationContext } from "@/hooks/useResidentNavigationContext";
import { useResidentCareAnalytics } from "@/hooks/useResidentCareDelivery";
import { DmeRegisterCard } from "@/components/residents/DmeRegisterCard";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResidentCareActionForms } from "@/components/residents/ResidentCareActionForms";
import { addDaysIso, todayIso } from "@/lib/scheduleDates";

function dateDaysAgo(days: number) {
  return addDaysIso(todayIso(), -days);
}

function MetricCard({ title, value, description, tone = "default" }: { title: string; value: string | number; description: string; tone?: "default" | "warning" | "success" }) {
  const className = tone === "warning" ? "border-amber-300 bg-amber-50" : tone === "success" ? "border-emerald-300 bg-emerald-50" : "";
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-2 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function ResidentCareDelivery() {
  const { user } = useAuth();
  // register_resident_dme_item, schedule_resident_appointment and start_hospital_transfer all run
  // assert_resident_care_manager, so the write cards are offered only to roles it admits; the
  // route itself also admits auditors, who get the analytics/routes/guardrails tabs.
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const { viewingOrgId } = useViewingOrg();
  const selectedOrgId = viewingOrgId ?? user?.organizationId ?? null;
  const facilities = useListFacilities({ organizationId: selectedOrgId ?? undefined }, Boolean(selectedOrgId));
  const { facilityId, residentId, setFacilityId, setResidentId } = useResidentNavigationContext();
  const [from, setFrom] = useState(dateDaysAgo(30));
  const [through, setThrough] = useState(dateDaysAgo(0));
  const effectiveFacilityId = facilityId
    ? facilities.data?.find(facility => facility.id === facilityId)?.id ?? ""
    : facilities.data?.[0]?.id ?? "";
  const residents = useListResidents({ facilityId: effectiveFacilityId, status: "active" }, { enabled: Boolean(effectiveFacilityId) });
  const analytics = useResidentCareAnalytics({ facilityId: effectiveFacilityId, from, through });

  const serviceCompletionPct = useMemo(() => {
    const numerator = analytics.data?.serviceCompletion.numerator ?? 0;
    const denominator = analytics.data?.serviceCompletion.denominator ?? 0;
    return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : "N/A";
  }, [analytics.data]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <HeartPulse className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-tight">Resident Care Delivery</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Staff-managed support-plan, service exception, DME, appointment, hospital-transfer, and return follow-up controls. This workspace routes care-operational issues into existing service delivery, change-of-condition, work queue, documents, and command-center workflows. Clinical records — vitals, care plans, assessments, progress notes, and FHIR-integrated medications, allergies, and diagnoses — live in the resident clinical chart.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/app/services">Open service queue</Link></Button>
          <Button asChild variant="outline"><Link href="/app/change-of-condition">Change-of-condition</Link></Button>
          <Button asChild><Link href="/app/work">Operational work</Link></Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scope and reporting period</CardTitle>
          <CardDescription>Metrics disclose the numerator, denominator, date basis, and facility scope used by the RLS-scoped analytics RPC.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="facility">Facility</Label>
            <Select value={effectiveFacilityId} onValueChange={setFacilityId}>
              <SelectTrigger id="facility" aria-label="Select facility"><SelectValue placeholder="Select facility" /></SelectTrigger>
              <SelectContent>{facilities.data?.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label htmlFor="from">From</Label><Input id="from" type="date" value={from} onChange={event => setFrom(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="through">Through</Label><Input id="through" type="date" value={through} onChange={event => setThrough(event.target.value)} /></div>
          <div className="flex items-end"><Button variant="outline" onClick={() => analytics.refetch()} disabled={analytics.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
        </CardContent>
      </Card>

      {analytics.isError ? <QueryError error={analytics.error} onRetry={() => analytics.refetch()} /> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-live="polite">
        <MetricCard title="Service completion" value={analytics.isLoading ? "Loading" : serviceCompletionPct} description={analytics.data?.serviceCompletion.definition ?? "Completed service tasks divided by scheduled service tasks."} tone="success" />
        <MetricCard title="Service exceptions" value={analytics.data?.serviceExceptions.count ?? "—"} description={analytics.data?.serviceExceptions.definition ?? "Refused, unavailable, missed, or late services."} tone="warning" />
        <MetricCard title="Overdue plan reviews" value={analytics.data?.planReviewTimeliness.overdue ?? "—"} description={analytics.data?.planReviewTimeliness.definition ?? "Effective plans past review due date."} tone="warning" />
        <MetricCard title="DME inspections due" value={analytics.data?.dmeInspectionStatus.due ?? "—"} description={analytics.data?.dmeInspectionStatus.definition ?? "DME missing inspection inside configured frequency."} />
      </div>

      <Tabs defaultValue="actions" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:w-auto md:grid-cols-4">
          <TabsTrigger value="actions">Staff actions</TabsTrigger>
          <TabsTrigger value="reporting">Analytics</TabsTrigger>
          <TabsTrigger value="routes">Routes</TabsTrigger>
          <TabsTrigger value="guardrails">Guardrails</TabsTrigger>
        </TabsList>
        <TabsContent value="actions" className="grid gap-4 xl:grid-cols-3">
          {!canManage ? (
            <Card className="xl:col-span-3">
              <CardContent className="p-6 text-sm text-muted-foreground">
                Registering DME, scheduling appointments and starting transfer episodes are manager actions.
                Your role can review the analytics, routes and guardrails tabs.
              </CardContent>
            </Card>
          ) : (
          <>
          {residents.isError && <div className="xl:col-span-3"><QueryError what="active residents" error={residents.error} onRetry={() => residents.refetch()} /></div>}
          <ResidentCareActionForms
            key={JSON.stringify([effectiveFacilityId, residentId])}
            facilityId={effectiveFacilityId}
            residentId={residentId}
            residents={residents.data ?? []}
            residentsReady={!residents.isLoading && !residents.isError && !!residents.data}
            onResidentChange={setResidentId}
          />
          <div className="xl:col-span-3">
            <DmeRegisterCard facilityId={effectiveFacilityId || undefined} residents={residents.data ?? []} />
          </div>
          </>
          )}
        </TabsContent>

        <TabsContent value="reporting" className="grid gap-4 md:grid-cols-3">
          <MetricCard title="Repeated refusals" value={analytics.data?.repeatedRefusals.count ?? "—"} description={analytics.data?.repeatedRefusals.definition ?? "Resident/service repeated refusal patterns."} tone="warning" />
          <MetricCard title="Change-of-condition frequency" value={analytics.data?.changeOfConditionFrequency.count ?? "—"} description={analytics.data?.changeOfConditionFrequency.definition ?? "Events first observed in period."} />
          <MetricCard title="Hospital-return open follow-up" value={analytics.data?.hospitalReturnsOpenFollowUp.count ?? "—"} description={analytics.data?.hospitalReturnsOpenFollowUp.definition ?? "Returned transfer episodes with open follow-up work."} tone="warning" />
        </TabsContent>

        <TabsContent value="routes" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[{ href: "/app/residents", label: "Resident summary", icon: Activity }, { href: "/app/services", label: "Service tasks", icon: ClipboardCheck }, { href: "/app/change-of-condition", label: "Condition follow-up", icon: Stethoscope }, { href: "/app/admissions", label: "Transitions & occupancy", icon: Hospital }].map(item => <Card key={item.href}><CardContent className="flex items-center justify-between p-4"><div className="flex items-center gap-2"><item.icon className="h-5 w-5" /><span>{item.label}</span></div><Button asChild size="sm" variant="outline"><Link href={item.href}>Open</Link></Button></CardContent></Card>)}
        </TabsContent>

        <TabsContent value="guardrails">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />CareBase boundary controls</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-2">
              <Badge variant="outline" className="justify-start p-3">No resident, family, prospect, or responsible-party portal is created.</Badge>
              <Badge variant="outline" className="justify-start p-3">Hospital-return medication reconciliation is tracked as status; medications are ingested read-only via FHIR rather than administered in CareBase.</Badge>
              <Badge variant="outline" className="justify-start p-3">Assessment rules may propose changes; human review is required for regulated support-plan decisions.</Badge>
              <Badge variant="outline" className="justify-start p-3">Effective support-plan versions are immutable; approved changes create future requirements only.</Badge>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
