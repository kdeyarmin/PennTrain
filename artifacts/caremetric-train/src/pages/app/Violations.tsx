import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useListViolations, useCreateViolation, type ViolationInsert } from "@/hooks/useViolations";
import { useListCitationTopics } from "@/hooks/useCitationTopics";
import { useListFacilities } from "@/hooks/useFacilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 15;

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function SeverityBadge({ severity }: { severity: string }) {
  const className =
    severity === "high" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : severity === "moderate" ? "bg-warning text-warning-foreground hover:bg-warning/80"
    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"; // low
  return <Badge className={className} variant="outline">{humanize(severity)}</Badge>;
}

export function StatusPill({ status }: { status: string }) {
  const className =
    status === "verified" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "corrected" ? "bg-info text-info-foreground hover:bg-info/80"
    : status === "poc_submitted" ? "bg-warning text-warning-foreground hover:bg-warning/80"
    : "bg-muted text-muted-foreground"; // open
  return <Badge className={className} variant="outline">{humanize(status)}</Badge>;
}

interface ViolationFormData {
  facilityId: string;
  citationTopicId: string;
  citationRef: string;
  inspectionDate: string;
  surveyorName: string;
  description: string;
  severity: "low" | "moderate" | "high";
  pocDueDate: string;
}

const EMPTY_FORM: ViolationFormData = {
  facilityId: "", citationTopicId: "", citationRef: "",
  inspectionDate: new Date().toISOString().slice(0, 10), surveyorName: "",
  description: "", severity: "moderate", pocDueDate: "",
};

export default function Violations() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [facilityFilter, setFacilityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ViolationFormData>(EMPTY_FORM);
  const [sourceInspectionEventId, setSourceInspectionEventId] = useState<string | null>(null);

  const locationSearch = useSearch();

  // Mirrors dhs_violations_insert/update RLS -- trainer and self-service are both excluded,
  // matching incidents' sensitivity model since a cited violation is an org-compliance matter.
  const canManage = ["org_admin", "facility_manager"].includes(user?.role ?? "");

  const { data: facilities } = useListFacilities();
  const { data: citationTopics } = useListCitationTopics();
  const { data: violations, isLoading } = useListViolations({
    facilityId: facilityFilter !== "all" ? facilityFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const { mutate: createViolation, isPending: creating } = useCreateViolation();

  const facilityById = useMemo(() => new Map((facilities ?? []).map((f) => [f.id, f])), [facilities]);
  const topicById = useMemo(() => new Map((citationTopics ?? []).map((t) => [t.id, t])), [citationTopics]);

  const allViolations = violations ?? [];
  const totalPages = Math.max(1, Math.ceil(allViolations.length / PAGE_SIZE));
  const paginated = allViolations.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setSourceInspectionEventId(null);
    setShowForm(true);
  };

  // InspectionItemDetail.tsx's "Create Violation from this Finding" links here with
  // ?action=add&facilityId=&inspectionDate=&description=&sourceEventId=&citationTopicId=, expecting
  // this dialog to open pre-filled. Runs once on mount only, mirroring Employees.tsx's ?action=add.
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    if (params.get("action") === "add") {
      setForm({
        ...EMPTY_FORM,
        facilityId: params.get("facilityId") ?? "",
        inspectionDate: params.get("inspectionDate") ?? EMPTY_FORM.inspectionDate,
        description: params.get("description") ?? "",
        citationTopicId: params.get("citationTopicId") ?? "",
      });
      setSourceInspectionEventId(params.get("sourceEventId"));
      setShowForm(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = () => {
    if (!form.facilityId || !form.description.trim() || !form.inspectionDate) {
      toast({ title: "Facility, inspection date, and description are required", variant: "destructive" });
      return;
    }
    const facility = facilityById.get(form.facilityId);
    if (!facility) return;

    const payload: ViolationInsert = {
      organization_id: facility.organization_id,
      facility_id: facility.id,
      citation_topic_id: form.citationTopicId || null,
      citation_ref: form.citationRef.trim() || null,
      inspection_date: form.inspectionDate,
      surveyor_name: form.surveyorName.trim() || null,
      description: form.description.trim(),
      severity: form.severity,
      poc_due_date: form.pocDueDate || null,
      source_inspection_event_id: sourceInspectionEventId,
    };

    createViolation(payload, {
      onSuccess: () => { toast({ title: "Violation recorded" }); setShowForm(false); },
      onError: (e: Error) => toast({ title: "Failed to record violation", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Violations &amp; Plans of Correction</h1>
          <p>Enter cited violations from a DHS inspection and manage their Plan of Correction through to verification.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> Record Violation
          </Button>
        )}
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <Select value={facilityFilter} onValueChange={(v) => { setFacilityFilter(v); setPage(1); }}>
            <SelectTrigger className="w-48 h-9 bg-card"><SelectValue placeholder="All Facilities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Facilities</SelectItem>
              {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44 h-9 bg-card"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["open", "poc_submitted", "corrected", "verified"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No violations found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {canManage ? "Record a cited violation to start its Plan of Correction." : "Try adjusting your filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Inspection Date</th>
                    <th>Facility</th>
                    <th>Citation</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((v) => (
                    <tr key={v.id}>
                      <td className="text-muted-foreground">{new Date(v.inspection_date).toLocaleDateString()}</td>
                      <td className="font-medium text-foreground">{facilityById.get(v.facility_id)?.name ?? "—"}</td>
                      <td className="text-muted-foreground">
                        {v.citation_ref ?? topicById.get(v.citation_topic_id ?? "")?.title ?? "—"}
                      </td>
                      <td><SeverityBadge severity={v.severity} /></td>
                      <td><StatusPill status={v.status} /></td>
                      <td>
                        <Link href={`/app/violations/${v.id}`} className="text-sm text-primary hover:underline">View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border/60">
              <p className="text-[13px] text-muted-foreground">
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, allViolations.length)}</span> of {allViolations.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[13px] text-muted-foreground px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record Cited Violation</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Facility *</Label>
                <Select value={form.facilityId} onValueChange={(v) => setForm((f) => ({ ...f, facilityId: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select facility" /></SelectTrigger>
                  <SelectContent>
                    {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Inspection Date *</Label>
                <Input type="date" value={form.inspectionDate} onChange={(e) => setForm((f) => ({ ...f, inspectionDate: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Citation Topic</Label>
                <Select
                  value={form.citationTopicId}
                  onValueChange={(v) => {
                    const topic = citationTopics?.find((t) => t.id === v);
                    setForm((f) => ({
                      ...f,
                      citationTopicId: v,
                      citationRef: f.citationRef.trim() ? f.citationRef : (topic?.citation_ref ?? f.citationRef),
                    }));
                  }}
                >
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select topic (optional)" /></SelectTrigger>
                  <SelectContent>
                    {citationTopics?.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Citation Reference</Label>
                <Input value={form.citationRef} onChange={(e) => setForm((f) => ({ ...f, citationRef: e.target.value }))} placeholder="e.g. 55 Pa. Code 2600.42(a)" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Surveyor Name</Label>
                <Input value={form.surveyorName} onChange={(e) => setForm((f) => ({ ...f, surveyorName: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v as ViolationFormData["severity"] }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low", "moderate", "high"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Plan of Correction Due Date</Label>
                <Input type="date" value={form.pocDueDate} onChange={(e) => setForm((f) => ({ ...f, pocDueDate: e.target.value }))} className="h-9" />
              </div>
              <div className="col-span-full space-y-1.5">
                <Label className="text-[13px]">Violation Description *</Label>
                <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What the surveyor cited, quoted or paraphrased from the inspection report" rows={4} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating} className="shadow-sm">
              {creating ? "Saving..." : "Record Violation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
