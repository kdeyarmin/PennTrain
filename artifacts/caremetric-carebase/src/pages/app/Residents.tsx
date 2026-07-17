import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useCreateResident, type Resident, type ResidentInsert } from "@/hooks/useResidents";
import { usePaginatedDomainList } from "@/hooks/usePaginatedDomainLists";
import { EMPTY_RESIDENT_LIST_SUMMARY, useResidentListSummary } from "@/hooks/useDomainListSummaries";
import { useListFacilities } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BedDouble, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { complianceStatusBadgeClassName, getComplianceFormLabel, formatDateOnly } from "@/lib/residentCompliance";
import { toLocalIsoDate } from "@/lib/dateUtils";

const PAGE_SIZE = 15;

type ResidentRosterRow = Resident & {
  compliance_worst_status: string | null;
  compliance_open_count: number;
};

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function StatusPill({ status }: { status: string }) {
  const className = status === "active"
    ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "reserved"
      ? "bg-purple-100 text-purple-900"
      : status === "temporarily_out" || status === "hospital_leave"
        ? "bg-amber-100 text-amber-900"
        : status === "deceased"
          ? "bg-slate-200 text-slate-900"
          : "bg-muted text-muted-foreground";
  return <Badge className={className} variant="outline">{humanize(status)}</Badge>;
}

interface ResidentFormData {
  facilityId: string;
  firstName: string;
  lastName: string;
  room: string;
  admissionDate: string;
  sdcu: boolean;
  hospice: boolean;
  admissionTrack: "standard" | "expedited";
}

const EMPTY_FORM: ResidentFormData = {
  facilityId: "", firstName: "", lastName: "", room: "",
  admissionDate: toLocalIsoDate(), sdcu: false, hospice: false, admissionTrack: "standard",
};

const RESIDENTS_URL_DEFAULTS = { search: "", facility: "all", status: "active", page: "1" };

export default function Residents() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [urlState, setUrlState] = useUrlState(RESIDENTS_URL_DEFAULTS);
  const [search, setSearch] = useState(urlState.search);
  const page = Math.max(1, Number(urlState.page) || 1);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ResidentFormData>(EMPTY_FORM);

  // Mirrors residents_insert/update RLS -- trainer and self-service are both excluded (residents
  // have no accounts of their own), same sensitivity model as violations/incidents.
  const canManage = ["org_admin", "facility_manager"].includes(user?.role ?? "");

  const { data: facilities } = useListFacilities();
  const residentQuery = usePaginatedDomainList<ResidentRosterRow>("residents", {
    facilityId: urlState.facility !== "all" ? urlState.facility : undefined,
    status: urlState.status !== "all" ? urlState.status : undefined,
    search: urlState.search,
    page,
    pageSize: PAGE_SIZE,
  });
  const residentSummaryQuery = useResidentListSummary({
    facilityId: urlState.facility !== "all" ? urlState.facility : undefined,
    status: urlState.status !== "all" ? urlState.status : undefined,
    search: urlState.search,
    today: toLocalIsoDate(),
  });
  const residents = residentQuery.data?.rows ?? [];
  const totalCount = residentQuery.data?.count ?? 0;
  const isLoading = residentQuery.isLoading;
  const isError = residentQuery.isError || residentSummaryQuery.isError;
  const error = residentQuery.error ?? residentSummaryQuery.error;
  const refetch = () => Promise.all([residentQuery.refetch(), residentSummaryQuery.refetch()]);

  const { mutate: createResident, isPending: creating } = useCreateResident();

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
  const residentComplianceSummary = residentSummaryQuery.data ?? EMPTY_RESIDENT_LIST_SUMMARY;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setUrlState({ page: String(totalPages) });
  }, [page, setUrlState, totalPages]);

  // Auto-fill the create dialog's Facility field when the user is scoped to exactly one facility
  // (e.g. a facility_manager) -- saves a needless click every time; a no-op for multi-facility orgs.
  useEffect(() => {
    if (!showForm || facilities?.length !== 1) return;
    const soleId = facilities[0].id;
    setForm((f) => (f.facilityId ? f : { ...f, facilityId: soleId }));
  }, [showForm, facilities]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.facilityId || !form.firstName.trim() || !form.lastName.trim() || !form.admissionDate) {
      toast({ title: "Facility, name, and admission date are required", variant: "destructive" });
      return;
    }
    const facility = facilityById.get(form.facilityId);
    if (!facility) return;

    const payload: ResidentInsert = {
      organization_id: facility.organization_id,
      facility_id: facility.id,
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      room: form.room.trim() || null,
      admission_date: form.admissionDate,
      sdcu: form.sdcu,
      hospice: form.hospice,
      admission_track: facility.facility_type === "ALR" ? form.admissionTrack : "standard",
    };

    const formLabel = getComplianceFormLabel(facility.facility_type);
    createResident(payload, {
      onSuccess: () => { toast({ title: `Resident added — ${formLabel} compliance checklist generated` }); setShowForm(false); },
      onError: (e: Error) => toast({ title: "Failed to add resident", description: e.message, variant: "destructive" }),
    });
  };

  const selectedFacility = facilityById.get(form.facilityId);

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Residents</h1>
          <p>Track RASP/ASP compliance deadlines by resident — preadmission screening through annual reassessment. No charting or care-plan data is stored here.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> Add Resident
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <button type="button" className="premium-card p-4 text-left hover:border-border" onClick={() => setUrlState({ status: "active", page: "1" })}>
          <p className="text-xs font-medium text-muted-foreground">Active residents</p>
          <p className="mt-1 text-2xl font-semibold">{residentComplianceSummary.activeResidents}</p>
          <p className="mt-1 text-xs text-muted-foreground">{residentComplianceSummary.residents} total in this view.</p>
        </button>
        <div className="premium-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Residents with gaps</p>
          <p className="mt-1 text-2xl font-semibold text-destructive">{residentComplianceSummary.residentsWithOpenItems}</p>
          <p className="mt-1 text-xs text-muted-foreground">Have missing, due-soon, or expired items.</p>
        </div>
        <div className="premium-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Open compliance items</p>
          <p className="mt-1 text-2xl font-semibold">{residentComplianceSummary.expiredItems + residentComplianceSummary.missingItems + residentComplianceSummary.dueSoonItems}</p>
          <p className="mt-1 text-xs text-muted-foreground">{residentComplianceSummary.expiredItems} expired · {residentComplianceSummary.missingItems} missing · {residentComplianceSummary.dueSoonItems} due soon</p>
        </div>
        <div className="premium-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Next 14 days</p>
          <p className="mt-1 text-2xl font-semibold">{residentComplianceSummary.dueWithin14Days}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {residentComplianceSummary.newestAdmissionResidentId ? (
              <Link href={`/app/residents/${residentComplianceSummary.newestAdmissionResidentId}`} className="text-primary hover:underline">Review newest admission</Link>
            ) : "No admissions in this view."}
          </p>
        </div>
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search residents..."
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
              {["reserved", "active", "temporarily_out", "hospital_leave", "discharged", "deceased"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isError ? (
          <div className="p-6">
            <QueryError what="residents" error={error} onRetry={() => refetch()} />
          </div>
        ) : isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : residents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <BedDouble className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No residents found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {canManage ? "Add a resident to start their RASP/ASP compliance checklist." : "Try adjusting your filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[900px]">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Facility</th>
                    <th>Room</th>
                    <th>Admission Date</th>
                    <th>Flags</th>
                    <th>Compliance</th>
                    <th>Status</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {residents.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium text-foreground">{r.last_name}, {r.first_name}</td>
                      <td className="text-muted-foreground">{facilityById.get(r.facility_id)?.name ?? "—"}</td>
                      <td className="text-muted-foreground">{r.room ?? "—"}</td>
                      <td className="text-muted-foreground">{formatDateOnly(r.admission_date)}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          {r.sdcu && <Badge variant="outline" className="text-[10px]">SDCU</Badge>}
                          {r.hospice && <Badge variant="outline" className="text-[10px]">Hospice</Badge>}
                          {!r.sdcu && !r.hospice && <span className="text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td>
                        {(() => {
                          if (!r.compliance_worst_status) return <span className="text-muted-foreground">—</span>;
                          return (
                            <div className="flex items-center gap-1.5">
                              <Badge className={complianceStatusBadgeClassName(r.compliance_worst_status)} variant="outline">
                                {humanize(r.compliance_worst_status)}
                              </Badge>
                              {r.compliance_open_count > 0 && (
                                <span className="text-xs text-muted-foreground">{r.compliance_open_count} open</span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td><StatusPill status={r.status} /></td>
                      <td>
                        <Link href={`/app/residents/${r.id}`} className="text-sm text-primary hover:underline">View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border/60">
              <p className="text-[13px] text-muted-foreground">
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)}</span> of {totalCount}
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
          <DialogHeader><DialogTitle>Add Resident</DialogTitle></DialogHeader>
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
                <Label className="text-[13px]">Room</Label>
                <Input value={form.room} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">First Name *</Label>
                <Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Last Name *</Label>
                <Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Admission Date *</Label>
                <Input type="date" value={form.admissionDate} onChange={(e) => setForm((f) => ({ ...f, admissionDate: e.target.value }))} className="h-9" />
              </div>
              <div className="flex items-end gap-4 pb-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.sdcu} onChange={(e) => setForm((f) => ({ ...f, sdcu: e.target.checked }))} />
                  Secured Dementia Care Unit
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.hospice} onChange={(e) => setForm((f) => ({ ...f, hospice: e.target.checked }))} />
                  Hospice
                </label>
              </div>
              {selectedFacility?.facility_type === "ALR" && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-[13px]">Admission Track</Label>
                  <Select
                    value={form.admissionTrack}
                    onValueChange={(v) => setForm((f) => ({ ...f, admissionTrack: v as ResidentFormData["admissionTrack"] }))}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard (assessment due 30 days before admission)</SelectItem>
                      <SelectItem value="expedited">Expedited (assessment due 15 days after admission)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Expedited applies only for: direct transfer from an acute-care hospital, admission to escape an
                    abusive situation, or no alternative living arrangement available.
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating} className="shadow-sm">
              {creating ? "Saving..." : "Add Resident"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
