import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListResidents, useCreateResident, type ResidentInsert } from "@/hooks/useResidents";
import { useListFacilities } from "@/hooks/useFacilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BedDouble, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 15;

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function StatusPill({ status }: { status: string }) {
  const className =
    status === "discharged" ? "bg-muted text-muted-foreground"
    : "bg-success text-success-foreground hover:bg-success/80"; // active
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
}

const EMPTY_FORM: ResidentFormData = {
  facilityId: "", firstName: "", lastName: "", room: "",
  admissionDate: new Date().toISOString().slice(0, 10), sdcu: false, hospice: false,
};

export default function Residents() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [facilityFilter, setFacilityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [page, setPage] = useState(1);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ResidentFormData>(EMPTY_FORM);

  // Mirrors residents_insert/update RLS -- trainer and self-service are both excluded (residents
  // have no accounts of their own), same sensitivity model as violations/incidents.
  const canManage = ["org_admin", "facility_manager"].includes(user?.role ?? "");

  const { data: facilities } = useListFacilities();
  const { data: residents, isLoading } = useListResidents({
    facilityId: facilityFilter !== "all" ? facilityFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const { mutate: createResident, isPending: creating } = useCreateResident();

  const facilityById = useMemo(() => new Map((facilities ?? []).map((f) => [f.id, f])), [facilities]);

  const allResidents = residents ?? [];
  const totalPages = Math.max(1, Math.ceil(allResidents.length / PAGE_SIZE));
  const paginated = allResidents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
    };

    createResident(payload, {
      onSuccess: () => { toast({ title: "Resident added — RASP compliance checklist generated" }); setShowForm(false); },
      onError: (e: Error) => toast({ title: "Failed to add resident", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Residents</h1>
          <p>Track RASP compliance deadlines by resident — preadmission screening through annual reassessment. No charting or care-plan data is stored here.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> Add Resident
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
              {["active", "discharged"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <BedDouble className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No residents found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {canManage ? "Add a resident to start their RASP compliance checklist." : "Try adjusting your filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Facility</th>
                    <th>Room</th>
                    <th>Admission Date</th>
                    <th>Flags</th>
                    <th>Status</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium text-foreground">{r.last_name}, {r.first_name}</td>
                      <td className="text-muted-foreground">{facilityById.get(r.facility_id)?.name ?? "—"}</td>
                      <td className="text-muted-foreground">{r.room ?? "—"}</td>
                      <td className="text-muted-foreground">{new Date(r.admission_date).toLocaleDateString()}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          {r.sdcu && <Badge variant="outline" className="text-[10px]">SDCU</Badge>}
                          {r.hospice && <Badge variant="outline" className="text-[10px]">Hospice</Badge>}
                          {!r.sdcu && !r.hospice && <span className="text-muted-foreground">—</span>}
                        </div>
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
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, allResidents.length)}</span> of {allResidents.length}
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
