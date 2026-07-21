import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, ChevronRight, MessageSquareWarning, Plus, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { usePaginatedComplaints } from "@/hooks/useComplaints";
import { useComplaintListSummary, EMPTY_COMPLAINT_LIST_SUMMARY } from "@/hooks/useDomainListSummaries";
import { useListFacilities } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import { CreateComplaintDialog, COMPLAINT_CATEGORIES, COMPLAINT_STATUSES, humanizeComplaint } from "@/components/complaints/CreateComplaintDialog";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_CLASS: Record<string, string> = {
  received: "bg-blue-100 text-blue-900", acknowledged: "bg-cyan-100 text-cyan-900",
  investigating: "bg-amber-100 text-amber-900", response_pending: "bg-purple-100 text-purple-900",
  appeal: "bg-orange-100 text-orange-900", monitoring: "bg-indigo-100 text-indigo-900",
  pending_closure: "bg-violet-100 text-violet-900", closed: "bg-emerald-100 text-emerald-900",
};

const PAGE_SIZE = 25;

export default function Complaints() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  const canManage = user?.role !== "auditor";
  const [showCreate, setShowCreate] = useState(false);
  const [urlState, setUrlState] = useUrlState({ facility: "all", status: "active", category: "all", search: "", page: "1" });
  const page = Math.max(1, Number(urlState.page) || 1);

  const facilityScope = urlState.facility === "all" ? undefined : urlState.facility;
  const categoryScope = urlState.category === "all" ? undefined : urlState.category;
  const specificStatus = urlState.status === "all" || urlState.status === "active" ? undefined : urlState.status;
  const excludeStatus = urlState.status === "active" ? "closed" : undefined;

  const complaints = usePaginatedComplaints({
    organizationId,
    facilityId: facilityScope,
    status: specificStatus,
    excludeStatus,
    category: categoryScope,
    search: urlState.search,
    page,
    pageSize: PAGE_SIZE,
  });
  // Tiles measure the facility/status/category scope (not the row search), matching the prior view.
  const summaryQuery = useComplaintListSummary({ organizationId, facilityId: facilityScope, status: specificStatus, category: categoryScope });
  const summary = summaryQuery.data ?? EMPTY_COMPLAINT_LIST_SUMMARY;
  const facilities = useListFacilities({ organizationId });

  const rows = complaints.data?.rows ?? [];
  const total = complaints.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const metrics = [
    { label: "Open cases", value: summary.openCases, icon: MessageSquareWarning, color: "text-blue-600" },
    { label: "Awaiting acknowledgement", value: summary.awaitingAcknowledgement, icon: AlertTriangle, color: "text-amber-600" },
    { label: "High or imminent risk", value: summary.highOrImminentRisk, icon: ShieldAlert, color: "text-red-600" },
    { label: "Incident-linked", value: summary.incidentLinked, icon: CheckCircle2, color: "text-purple-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold"><MessageSquareWarning className="h-6 w-6" />Complaints, Grievances & Resident Rights</h1><p className="text-muted-foreground">Separate case management with safety escalation, investigation, response, appeal, nonretaliation monitoring, and closure approval.</p></div>
        {canManage && <Button onClick={() => setShowCreate(true)}><Plus className="mr-2 h-4 w-4" />New complaint</Button>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(metric => <Card key={metric.label}><CardContent className="flex items-center gap-3 pt-6"><metric.icon className={`h-7 w-7 ${metric.color}`} /><div><p className="text-2xl font-bold">{summaryQuery.isLoading ? "—" : metric.value}</p><p className="text-sm text-muted-foreground">{metric.label}</p></div></CardContent></Card>)}</div>
      <Card><CardContent className="space-y-4 pt-6">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Select value={urlState.facility} onValueChange={value => setUrlState({ facility: value, page: "1" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All facilities</SelectItem>{facilities.data?.map(facility => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select>
          <Select value={urlState.status} onValueChange={value => setUrlState({ status: value, page: "1" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">All active</SelectItem><SelectItem value="all">All statuses</SelectItem>{COMPLAINT_STATUSES.map(value => <SelectItem key={value} value={value}>{humanizeComplaint(value)}</SelectItem>)}</SelectContent></Select>
          <Select value={urlState.category} onValueChange={value => setUrlState({ category: value, page: "1" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{COMPLAINT_CATEGORIES.map(value => <SelectItem key={value} value={value}>{humanizeComplaint(value)}</SelectItem>)}</SelectContent></Select>
          <Input value={urlState.search} onChange={event => setUrlState({ search: event.target.value, page: "1" })} placeholder="Search case number, category, or complainant" aria-label="Search complaints" />
        </div>
        {complaints.isError ? <QueryError what="complaints" error={complaints.error as Error} onRetry={() => complaints.refetch()} /> : complaints.isLoading ? <div className="space-y-2">{[...Array(5)].map((_, index) => <div key={index} className="h-16 animate-pulse rounded bg-muted" />)}</div> : !rows.length ? <div className="py-12 text-center"><CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" /><p className="font-medium">No complaint cases match this view</p></div> : <>
          <div className="overflow-x-auto"><table className="data-table min-w-[1050px]"><thead><tr><th>Case</th><th>Received</th><th>Resident / complainant</th><th>Category</th><th>Risk</th><th>Investigator</th><th>Status</th><th /></tr></thead><tbody>{rows.map(complaint => <tr key={complaint.id}>
          <td><p className="font-medium">{complaint.complaint_number}</p><p className="max-w-[260px] truncate text-xs text-muted-foreground">{complaint.description}</p></td>
          <td className="text-sm">{new Date(complaint.date_received).toLocaleString()}<p className="text-xs text-muted-foreground">{humanizeComplaint(complaint.method_received)}</p></td>
          <td><p className="text-sm">{complaint.resident ? `${complaint.resident.first_name} ${complaint.resident.last_name}` : "No resident linked"}</p><p className="text-xs text-muted-foreground">{complaint.is_anonymous ? "Anonymous complainant" : complaint.complainant_name}</p></td>
          <td className="text-sm">{humanizeComplaint(complaint.category)}</td>
          <td><Badge variant={complaint.immediate_risk === "imminent" || complaint.immediate_risk === "high" ? "destructive" : "outline"}>{humanizeComplaint(complaint.immediate_risk)}</Badge>{complaint.incident_id && <p className="mt-1 text-xs text-red-700">Incident linked</p>}</td>
          <td className="text-sm">{complaint.investigator ? `${complaint.investigator.first_name} ${complaint.investigator.last_name}` : "Unassigned"}</td>
          <td><Badge variant="outline" className={`border-0 ${STATUS_CLASS[complaint.status]}`}>{humanizeComplaint(complaint.status)}</Badge></td>
          <td><Button asChild size="sm" variant="outline"><Link href={`/app/complaints/${complaint.id}`}>Open <ChevronRight className="h-4 w-4" /></Link></Button></td>
        </tr>)}</tbody></table></div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setUrlState({ page: String(page - 1) })}>Previous</Button>
              <span className="px-1 text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setUrlState({ page: String(page + 1) })}>Next</Button>
            </div>
          </div>
        </>}
      </CardContent></Card>
      <CreateComplaintDialog open={showCreate} onOpenChange={setShowCreate} organizationId={organizationId} />
    </div>
  );
}
