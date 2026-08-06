import { useId, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useCreateViolation, type Violation, type ViolationInsert } from "@/hooks/useViolations";
import { usePaginatedViolations } from "@/hooks/usePaginatedDomainLists";
import { useListCitationTopics } from "@/hooks/useCitationTopics";
import { useListFacilities } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { facilityToday, formatDateForDisplay } from "@/lib/dateUtils";

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

const emptyForm = (): ViolationFormData => ({
  facilityId: "", citationTopicId: "", citationRef: "",
  inspectionDate: facilityToday(), surveyorName: "",
  description: "", severity: "moderate", pocDueDate: "",
});

const VIOLATIONS_URL_DEFAULTS = { search: "", facility: "all", status: "all", page: "1" };

export default function Violations() {
  const __fieldIds = useId();
  const { user } = useAuth();
  const { toast } = useToast();

  const [urlState, setUrlState] = useUrlState(VIOLATIONS_URL_DEFAULTS);
  const [search, setSearch] = useState(urlState.search);
  const page = Math.max(1, Number(urlState.page) || 1);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ViolationFormData>(emptyForm);
  const [sourceInspectionEventId, setSourceInspectionEventId] = useState<string | null>(null);

  const locationSearch = useSearch();

  // Mirrors dhs_violations_insert/update RLS -- trainer and self-service are both excluded,
  // matching incidents' sensitivity model since a cited violation is an org-compliance matter.
  const canManage = ["org_admin", "facility_manager"].includes(user?.role ?? "");

  const { data: facilities } = useListFacilities();
  const { data: citationTopics } = useListCitationTopics();
  const { data: violationsPage, isLoading, isError, error, refetch } = usePaginatedViolations<Violation>({
    facilityId: urlState.facility !== "all" ? urlState.facility : undefined,
    status: urlState.status !== "all" ? urlState.status : undefined,
    search: urlState.search,
    page,
    pageSize: PAGE_SIZE,
  });
  const violations = violationsPage?.rows ?? [];
  const totalCount = violationsPage?.count ?? 0;

  const { mutate: createViolation, isPending: creating } = useCreateViolation();

  // Debounce the free-text box before it commits to the URL (and re-filters/re-paginates below),
  // so typing doesn't replace the URL's query string on every keystroke. The commit runs through a
  // ref (refreshed every render) rather than closing over `urlState`/`setUrlState` directly --
  // setUrlState's snapshot of the URL is only as fresh as the render that created it, so a plain
  // `[search]`-keyed effect could fire 300ms later still holding a stale pre-update URL and wipe
  // out any other filter change made in the meantime.
  const commitSearchRef = useRef(() => {});
  commitSearchRef.current = () => {
    if (search !== urlState.search) setUrlState({ search, page: "1" });
  };
  useEffect(() => {
    const t = setTimeout(() => commitSearchRef.current(), 300);
    return () => clearTimeout(t);
  }, [search]);
  // Resyncs the input's local mirror when urlState.search changes for a reason other than the
  // commit above (browser Back/Forward, a bookmarked/deep link) -- otherwise the box shows a
  // stale value that the debounce would then commit right back over the state just navigated to.
  useEffect(() => {
    setSearch(urlState.search);
  }, [urlState.search]);

  const facilityById = useMemo(() => new Map((facilities ?? []).map((f) => [f.id, f])), [facilities]);
  const topicById = useMemo(() => new Map((citationTopics ?? []).map((t) => [t.id, t])), [citationTopics]);

  // Drives DataTable's Reset control, and distinguishes "nothing matches these filters"
  // from "nothing has been cited yet" in the empty state.
  const hasActiveFilters = urlState.facility !== "all" || urlState.status !== "all" || !!urlState.search;
  const resetFilters = () => {
    setSearch("");
    setUrlState({ search: "", facility: "all", status: "all", page: "1" });
  };

  // Auto-fill the create dialog's Facility field when the user is scoped to exactly one facility
  // (e.g. a facility_manager) -- saves a needless click every time; a no-op for multi-facility orgs,
  // and never overrides a facility already set (manually, or via the deep-link prefill below).
  useEffect(() => {
    if (!showForm || facilities?.length !== 1) return;
    const soleId = facilities[0].id;
    setForm((f) => (f.facilityId ? f : { ...f, facilityId: soleId }));
  }, [showForm, facilities]);

  const openCreate = () => {
    setForm(emptyForm());
    setSourceInspectionEventId(null);
    setShowForm(true);
  };

  // InspectionItemDetail.tsx's "Create Violation from this Finding" links here with
  // ?action=add&facilityId=&inspectionDate=&description=&sourceEventId=&citationTopicId=, expecting
  // this dialog to open pre-filled. Runs once on mount only, mirroring Employees.tsx's ?action=add.
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    if (params.get("action") === "add") {
      const base = emptyForm();
      setForm({
        ...base,
        facilityId: params.get("facilityId") ?? "",
        inspectionDate: params.get("inspectionDate") ?? base.inspectionDate,
        description: params.get("description") ?? "",
        citationTopicId: params.get("citationTopicId") ?? "",
      });
      setSourceInspectionEventId(params.get("sourceEventId"));
      setShowForm(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Covers the deep-link prefill above (citationTopicId can arrive pre-set before citationTopics has
  // even loaded) as well as any other path that sets citationTopicId without going through the
  // Citation Topic Select's own onValueChange autofill.
  useEffect(() => {
    if (!form.citationTopicId || form.citationRef.trim() || !citationTopics) return;
    const topic = citationTopics.find((t) => t.id === form.citationTopicId);
    if (topic?.citation_ref) {
      setForm((f) => (f.citationTopicId === topic.id && !f.citationRef.trim() ? { ...f, citationRef: topic.citation_ref! } : f));
    }
  }, [form.citationTopicId, form.citationRef, citationTopics]);

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
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search violations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 bg-card"
            />
          </div>
          <Select value={urlState.facility} onValueChange={(v) => setUrlState({ facility: v, page: "1" })}>
            <SelectTrigger className="w-48 h-9 bg-card"><SelectValue placeholder="All Facilities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Facilities</SelectItem>
              {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={urlState.status} onValueChange={(v) => setUrlState({ status: v, page: "1" })}>
            <SelectTrigger className="w-44 h-9 bg-card"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["open", "poc_submitted", "corrected", "verified"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="p-4">
          <DataTable
            rows={violations}
            totalCount={totalCount}
            getRowId={(v) => v.id}
            page={page}
            pageSize={PAGE_SIZE}
            isLoading={isLoading}
            error={isError ? error : null}
            errorLabel="violations"
            onRetry={() => void refetch()}
            onPageChange={(next) => setUrlState({ page: String(next) })}
            onResetFilters={hasActiveFilters ? resetFilters : undefined}
            activeFilterSummary={hasActiveFilters ? "· filtered" : undefined}
            emptyIcon={<ShieldAlert className="mb-3 h-10 w-10 text-muted-foreground/30" />}
            emptyTitle="No violations found"
            emptyDescription={
              hasActiveFilters
                ? "Try adjusting your filters."
                : canManage
                  ? "Record a cited violation to start its Plan of Correction."
                  : "Nothing has been cited yet."
            }
            emptyAction={canManage && !hasActiveFilters
              ? <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> Record Violation</Button>
              : undefined}
            columns={[
              {
                id: "inspection_date",
                header: "Inspection Date",
                cell: (v) => <span className="text-muted-foreground">{formatDateForDisplay(v.inspection_date)}</span>,
              },
              {
                id: "facility",
                header: "Facility",
                cell: (v) => <span className="font-medium text-foreground">{facilityById.get(v.facility_id)?.name ?? "—"}</span>,
              },
              {
                id: "citation",
                header: "Citation",
                cell: (v) => (
                  <span className="text-muted-foreground">
                    {v.citation_ref ?? topicById.get(v.citation_topic_id ?? "")?.title ?? "—"}
                  </span>
                ),
              },
              { id: "severity", header: "Severity", cell: (v) => <SeverityBadge severity={v.severity} /> },
              { id: "status", header: "Status", cell: (v) => <StatusPill status={v.status} /> },
              {
                id: "actions",
                header: "",
                className: "w-16",
                cell: (v) => <Link href={`/app/violations/${v.id}`} className="text-sm text-primary hover:underline">View</Link>,
              },
            ]}
            renderMobileCard={(v) => (
              <Link href={`/app/violations/${v.id}`} className="block">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{facilityById.get(v.facility_id)?.name ?? "—"}</span>
                  <StatusPill status={v.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {v.citation_ref ?? topicById.get(v.citation_topic_id ?? "")?.title ?? "—"}
                </p>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {formatDateForDisplay(v.inspection_date)}
                  <SeverityBadge severity={v.severity} />
                </p>
              </Link>
            )}
          />
        </div>
      </div>

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record Cited Violation</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-facility`} className="text-[13px]">Facility *</Label>
                <Select
                  value={form.facilityId}
                  onValueChange={(v) => {
                    setForm((f) => ({ ...f, facilityId: v }));
                    // A source event links a violation back to a specific facility's inspection --
                    // changing Facility after a "Create Violation from this Finding" deep-link would
                    // otherwise let the new violation carry a source event from a different facility.
                    setSourceInspectionEventId(null);
                  }}
                >
                  <SelectTrigger id={`${__fieldIds}-facility`} className="h-9"><SelectValue placeholder="Select facility" /></SelectTrigger>
                  <SelectContent>
                    {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-inspection-date`} className="text-[13px]">Inspection Date *</Label>
                <Input id={`${__fieldIds}-inspection-date`} type="date" value={form.inspectionDate} onChange={(e) => setForm((f) => ({ ...f, inspectionDate: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-citation-topic`} className="text-[13px]">Citation Topic</Label>
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
                  <SelectTrigger id={`${__fieldIds}-citation-topic`} className="h-9"><SelectValue placeholder="Select topic (optional)" /></SelectTrigger>
                  <SelectContent>
                    {citationTopics?.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-citation-reference`} className="text-[13px]">Citation Reference</Label>
                <Input id={`${__fieldIds}-citation-reference`} value={form.citationRef} onChange={(e) => setForm((f) => ({ ...f, citationRef: e.target.value }))} placeholder="e.g. 55 Pa. Code 2600.42(a)" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-surveyor-name`} className="text-[13px]">Surveyor Name</Label>
                <Input id={`${__fieldIds}-surveyor-name`} value={form.surveyorName} onChange={(e) => setForm((f) => ({ ...f, surveyorName: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-severity`} className="text-[13px]">Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v as ViolationFormData["severity"] }))}>
                  <SelectTrigger id={`${__fieldIds}-severity`} className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low", "moderate", "high"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-plan-of-correction-due-date`} className="text-[13px]">Plan of Correction Due Date</Label>
                <Input id={`${__fieldIds}-plan-of-correction-due-date`} type="date" value={form.pocDueDate} onChange={(e) => setForm((f) => ({ ...f, pocDueDate: e.target.value }))} className="h-9" />
              </div>
              <div className="col-span-full space-y-1.5">
                <Label htmlFor={`${__fieldIds}-violation-description`} className="text-[13px]">Violation Description *</Label>
                <Textarea id={`${__fieldIds}-violation-description`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What the surveyor cited, quoted or paraphrased from the inspection report" rows={4} />
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
