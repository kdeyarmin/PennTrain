<<<<<<< HEAD
import { useEffect, useMemo, useState } from "react";
=======
import { useEffect, useMemo, useRef, useState } from "react";
>>>>>>> origin/main
import { Link, useSearch } from "wouter";
import { useListViolations, useCreateViolation, type ViolationInsert } from "@/hooks/useViolations";
import { useListCitationTopics } from "@/hooks/useCitationTopics";
import { useListFacilities } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { formatDateForDisplay, toLocalIsoDate } from "@/lib/dateUtils";

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
  inspectionDate: toLocalIsoDate(), surveyorName: "",
  description: "", severity: "moderate", pocDueDate: "",
};

const VIOLATIONS_URL_DEFAULTS = { search: "", facility: "all", status: "all", page: "1" };

export default function Violations() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [urlState, setUrlState] = useUrlState(VIOLATIONS_URL_DEFAULTS);
  const [search, setSearch] = useState(urlState.search);
  const page = Math.max(1, Number(urlState.page) || 1);

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
    facilityId: urlState.facility !== "all" ? urlState.facility : undefined,
    status: urlState.status !== "all" ? urlState.status : undefined,
  });

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

  const searched = useMemo(() => {
    const q = urlState.search.trim().toLowerCase();
    if (!q) return violations ?? [];
    return (violations ?? []).filter((v) => {
      const citationText = v.citation_ref ?? topicById.get(v.citation_topic_id ?? "")?.title ?? "";
      return v.description.toLowerCase().includes(q) || citationText.toLowerCase().includes(q);
    });
  }, [violations, urlState.search, topicById]);

  const totalPages = Math.max(1, Math.ceil(searched.length / PAGE_SIZE));
  const paginated = searched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Auto-fill the create dialog's Facility field when the user is scoped to exactly one facility
  // (e.g. a facility_manager) -- saves a needless click every time; a no-op for multi-facility orgs,
  // and never overrides a facility already set (manually, or via the deep-link prefill below).
  useEffect(() => {
    if (!showForm || facilities?.length !== 1) return;
    const soleId = facilities[0].id;
    setForm((f) => (f.facilityId ? f : { ...f, facilityId: soleId }));
  }, [showForm, facilities]);

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
                      <td className="text-muted-foreground">{formatDateForDisplay(v.inspection_date)}</td>
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
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, searched.length)}</span> of {searched.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setUrlState({ page: String(Math.max(1, page - 1)) })} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[13px] text-muted-foreground px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setUrlState({ page: String(Math.min(totalPages, page + 1)) })} disabled={page === totalPages}>
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
