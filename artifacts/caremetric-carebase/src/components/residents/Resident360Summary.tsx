import { Link } from "wouter";
import { Activity, AlertTriangle, CalendarDays, DollarSign, HeartPulse, Utensils } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryError } from "@/components/QueryState";
import { useResident360Snapshot, useResidentTimeline } from "@/hooks/useResident360";

function Metric({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{detail}</p></div>;
}

export function Resident360Summary({ residentId }: { residentId: string }) {
  const snapshot = useResident360Snapshot(residentId);
  const timeline = useResidentTimeline(residentId, 40);
  const data = snapshot.data;
  const risks = data ? data.openRisks.incidents + data.openRisks.conditionChanges + data.openRisks.complaints + data.openRisks.complianceGaps : 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><HeartPulse className="h-5 w-5" />Resident 360</CardTitle><CardDescription>A resident-centered view across compliance, operations, service delivery, dietary, finance, and safety records.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {snapshot.isError ? <QueryError what="the resident 360 summary" error={snapshot.error} onRetry={() => snapshot.refetch()} /> : snapshot.isLoading || !data ? <div className="h-24 animate-pulse rounded bg-muted" /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Open risks" value={risks} detail={`${data.openRisks.incidents} incidents · ${data.openRisks.conditionChanges} condition changes`} /><Metric label="Compliance gaps" value={data.openRisks.complianceGaps} detail={`${data.openRisks.complaints} open complaints`} /><Metric label="Services due" value={data.serviceDelivery.dueNext24Hours} detail={`${data.serviceDelivery.exceptionsLast7Days} exceptions in 7 days`} /><Metric label="Resident balance" value={new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(data.finance.balance)} detail={`${data.dietary.openWeightMonitoring} active weight plan(s)`} /></div>}
          <div className="flex flex-wrap gap-2">
            <Link className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted" href={`/app/incidents?resident=${residentId}`}><AlertTriangle className="h-4 w-4" />Incidents</Link>
            <Link className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted" href={`/app/change-of-condition?resident=${residentId}`}><Activity className="h-4 w-4" />Condition changes</Link>
            <Link className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted" href={`/app/resident-services-calendar?resident=${residentId}`}><CalendarDays className="h-4 w-4" />Calendar</Link>
            <Link className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted" href={`/app/dietary-operations?resident=${residentId}`}><Utensils className="h-4 w-4" />Dietary</Link>
            <Link className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted" href={`/app/resident-finance?resident=${residentId}`}><DollarSign className="h-4 w-4" />Finance</Link>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" />Resident timeline</CardTitle><CardDescription>Newest resident-linked events from the system of record.</CardDescription></CardHeader>
        <CardContent>
          {timeline.isError ? <QueryError what="the resident timeline" error={timeline.error} onRetry={() => timeline.refetch()} /> : timeline.isLoading ? <div className="h-32 animate-pulse rounded bg-muted" /> : (timeline.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No linked timeline events yet.</p> : <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">{(timeline.data ?? []).map((event) => <Link key={`${event.event_type}:${event.source_id}`} href={event.href} className="block rounded-lg border p-3 hover:bg-muted"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Badge variant="outline">{event.event_type.replace(/_/g, " ")}</Badge><span className="font-medium">{event.title}</span></div><time className="text-xs text-muted-foreground">{new Date(event.occurred_at).toLocaleString()}</time></div>{event.detail ? <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{event.detail}</p> : null}{event.status ? <p className="mt-1 text-xs text-muted-foreground">Status: {event.status.replace(/_/g, " ")}</p> : null}</Link>)}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
