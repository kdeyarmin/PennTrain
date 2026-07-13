import { useEffect, useMemo, useRef, useState } from "react";
import { useListFacilities, useCreateFacility, useUpdateFacility, useDeleteFacility, type Facility } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Building2, ChevronRight, MapPin, Phone, Plus, Pencil, Trash2, Search } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useToast } from "@/hooks/use-toast";
import { FACILITY_TYPES, facilityTypeBadgeClass, facilityTypeLabel, type FacilityType } from "@/lib/facilityTypes";

interface FacilityFormData {
  name: string;
  facilityType: FacilityType;
  licenseNumber: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  administratorName: string;
  administratorEmail: string;
  isActive: boolean;
}

const EMPTY_FORM: FacilityFormData = {
  name: "", facilityType: "PCH", licenseNumber: "", address: "", city: "",
  state: "PA", zip: "", phone: "", administratorName: "", administratorEmail: "",
  isActive: true,
};

const FACILITIES_URL_DEFAULTS = { search: "" };

export default function Facilities() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const { data: facilities, isLoading, isError, error, refetch } = useListFacilities({ organizationId: viewingOrgId ?? undefined });
  const { toast } = useToast();
  const basePath = user?.role === "platform_admin" ? "/admin/facilities"
    : user?.role === "trainer" ? "/trainer/facilities"
    : "/app/facilities";

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<FacilityFormData>(EMPTY_FORM);

  const { mutate: createFacility, isPending: creating } = useCreateFacility();
  const { mutate: updateFacility, isPending: updating } = useUpdateFacility();
  const { mutate: deleteFacility, isPending: deleting } = useDeleteFacility();

  const canManage = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  const [urlState, setUrlState] = useUrlState(FACILITIES_URL_DEFAULTS);
  const [search, setSearch] = useState(urlState.search);

  // Debounce the free-text box before it commits to the URL (and re-filters the grid below), so
  // typing doesn't replace the URL's query string on every keystroke. The commit runs through a
  // ref (refreshed every render) rather than closing over `urlState`/`setUrlState` directly --
  // setUrlState's snapshot of the URL is only as fresh as the render that created it, so a plain
  // `[search]`-keyed effect could fire 300ms later still holding a stale pre-update URL and wipe
  // out any other filter change made in the meantime.
  const commitSearchRef = useRef(() => {});
  commitSearchRef.current = () => {
    if (search !== urlState.search) setUrlState({ search });
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

  const filteredFacilities = useMemo(() => {
    const q = urlState.search.trim().toLowerCase();
    if (!q) return facilities ?? [];
    return (facilities ?? []).filter((f) => f.name.toLowerCase().includes(q));
  }, [facilities, urlState.search]);

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (e: React.MouseEvent, facility: Facility) => {
    e.preventDefault();
    e.stopPropagation();
    setEditId(facility.id);
    setForm({
      name: facility.name,
      facilityType: (facility.facility_type as FacilityType) ?? "PCH",
      licenseNumber: facility.license_number ?? "",
      address: facility.address ?? "",
      city: facility.city ?? "",
      state: facility.state ?? "PA",
      zip: facility.zip ?? "",
      phone: facility.phone ?? "",
      administratorName: facility.administrator_name ?? "",
      administratorEmail: facility.administrator_email ?? "",
      isActive: facility.is_active !== false,
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast({ title: "Facility name is required", variant: "destructive" });
      return;
    }
    const payload = {
      name: form.name.trim(),
      facility_type: form.facilityType,
      license_number: form.licenseNumber || null,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
      zip: form.zip || null,
      phone: form.phone || null,
      administrator_name: form.administratorName || null,
      administrator_email: form.administratorEmail || null,
      is_active: form.isActive,
    };
    if (editId) {
      updateFacility(
        { id: editId, ...payload },
        {
          onSuccess: () => { toast({ title: "Facility updated" }); setShowForm(false); setEditId(null); },
          onError: (e: Error) => toast({ title: "Failed to update facility", description: e.message, variant: "destructive" }),
        },
      );
    } else if (user?.organizationId) {
      createFacility(
        { ...payload, organization_id: user.organizationId },
        {
          onSuccess: () => { toast({ title: "Facility created" }); setShowForm(false); setForm(EMPTY_FORM); },
          onError: (e: Error) => toast({ title: "Failed to create facility", description: e.message, variant: "destructive" }),
        },
      );
    } else {
      toast({ title: "No organization found for your account", variant: "destructive" });
    }
  };

  const field = (k: keyof FacilityFormData, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Facilities</h1>
          <p>View and manage your personal care, assisted living, nursing, home health, hospice, and group home facilities.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> Add Facility
          </Button>
        )}
      </div>

      <div className="premium-card">
        <div className="filter-bar flex-col items-stretch sm:flex-row sm:items-center">
          <div className="relative w-full flex-1 sm:min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search facilities..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 bg-card"
            />
          </div>
        </div>
      </div>

      {isError ? (
        <QueryError what="facilities" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-44 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredFacilities.map(facility => (
            <Link key={facility.id} href={`${basePath}/${facility.id}`}>
              <div className="premium-card p-5 cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group focus-within:ring-2 focus-within:ring-ring">
                <div className="flex items-start justify-between mb-4">
                  <div className="h-11 w-11 rounded-xl bg-primary/8 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary/70" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {canManage && (
                      <>
                        <Button variant="ghost" size="icon" className="h-9 w-9 sm:h-7 sm:w-7 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-foreground" onClick={(e) => openEdit(e, facility)} aria-label={`Edit ${facility.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 sm:h-7 sm:w-7 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteId(facility.id); }}
                          aria-label={`Delete ${facility.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    <ChevronRight className="hidden h-4 w-4 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/60 sm:block" />
                  </div>
                </div>

                <h3 className="font-semibold text-[15px] text-foreground mb-2">{facility.name}</h3>

                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className={`text-[10px] font-medium ${facilityTypeBadgeClass(facility.facility_type)}`}>
                    {facilityTypeLabel(facility.facility_type)}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] font-medium ${
                    facility.is_active
                      ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                      : "border-slate-200 text-slate-500 bg-slate-50"
                  }`}>
                    {facility.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  {(facility.city || facility.state) && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span>{[facility.city, facility.state].filter(Boolean).join(", ")}</span>
                    </div>
                  )}
                  {facility.phone && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{facility.phone}</span>
                    </div>
                  )}
                  {facility.license_number && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">{facility.license_number}</span>
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
          {filteredFacilities.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-16">
              <Building2 className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No facilities found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {facilities && facilities.length > 0 ? "Try adjusting your search." : "Add a facility to get started."}
              </p>
            </div>
          )}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={o => { if (!o) { setShowForm(false); setEditId(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Facility" : "Add Facility"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Facility Name *</Label>
              <Input value={form.name} onChange={e => field("name", e.target.value)} placeholder="Sunrise Manor" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Type *</Label>
              <Select value={form.facilityType} onValueChange={v => field("facilityType", v as FacilityType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FACILITY_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">License Number</Label>
              <Input value={form.licenseNumber} onChange={e => field("licenseNumber", e.target.value)} placeholder="LIC-0001" className="h-9" />
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Address</Label>
              <Input value={form.address} onChange={e => field("address", e.target.value)} placeholder="123 Main St" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">City</Label>
              <Input value={form.city} onChange={e => field("city", e.target.value)} placeholder="Philadelphia" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">State</Label>
              <Input value={form.state} onChange={e => field("state", e.target.value)} placeholder="PA" maxLength={2} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">ZIP</Label>
              <Input value={form.zip} onChange={e => field("zip", e.target.value)} placeholder="19103" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Phone</Label>
              <Input value={form.phone} onChange={e => field("phone", e.target.value)} placeholder="(215) 555-0100" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Administrator Name</Label>
              <Input value={form.administratorName} onChange={e => field("administratorName", e.target.value)} placeholder="Jane Smith" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Administrator Email</Label>
              <Input value={form.administratorEmail} onChange={e => field("administratorEmail", e.target.value)} placeholder="admin@facility.com" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Status</Label>
              <Select value={form.isActive ? "active" : "inactive"} onValueChange={v => field("isActive", v === "active")}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating || updating} className="shadow-sm">
              {creating || updating ? "Saving..." : editId ? "Save Changes" : "Create Facility"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={o => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Facility</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this facility? This action cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteId) return;
                deleteFacility(deleteId, {
                  onSuccess: () => { toast({ title: "Facility deleted" }); setDeleteId(null); },
                  onError: (e: Error) => toast({ title: "Failed to delete facility", description: e.message, variant: "destructive" }),
                });
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
