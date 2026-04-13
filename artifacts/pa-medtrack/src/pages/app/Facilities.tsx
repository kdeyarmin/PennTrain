import { useState } from "react";
import { useListFacilities, useCreateFacility, useUpdateFacility, useDeleteFacility } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Building2, ChevronRight, MapPin, Phone, Plus, Pencil, Trash2, Users } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface FacilityFormData {
  name: string;
  facilityType: "PCH" | "ALR";
  licenseNumber: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  administratorName: string;
  administratorEmail: string;
  capacity: string;
  isActive: boolean;
}

const EMPTY_FORM: FacilityFormData = {
  name: "", facilityType: "PCH", licenseNumber: "", address: "", city: "",
  state: "PA", zip: "", phone: "", administratorName: "", administratorEmail: "",
  capacity: "", isActive: true,
};

export default function Facilities() {
  const { data: facilities, isLoading } = useListFacilities({});
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const basePath = user?.role === "platform_admin" ? "/admin/facilities" : "/app/facilities";

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState<FacilityFormData>(EMPTY_FORM);

  const { mutate: createFacility, isPending: creating } = useCreateFacility({
    mutation: {
      onSuccess: () => {
        toast({ title: "Facility created" });
        queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });
        setShowForm(false);
        setForm(EMPTY_FORM);
      },
      onError: (e: unknown) => {
        toast({ title: "Failed to create facility", description: (e as Error).message, variant: "destructive" });
      },
    },
  });

  const { mutate: updateFacility, isPending: updating } = useUpdateFacility({
    mutation: {
      onSuccess: () => {
        toast({ title: "Facility updated" });
        queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });
        setShowForm(false);
        setEditId(null);
      },
      onError: (e: unknown) => {
        toast({ title: "Failed to update facility", description: (e as Error).message, variant: "destructive" });
      },
    },
  });

  const { mutate: deleteFacility, isPending: deleting } = useDeleteFacility({
    mutation: {
      onSuccess: () => {
        toast({ title: "Facility deleted" });
        queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });
        setDeleteId(null);
      },
      onError: (e: unknown) => {
        toast({ title: "Failed to delete facility", description: (e as Error).message, variant: "destructive" });
      },
    },
  });

  const canManage = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (e: React.MouseEvent, facility: typeof facilities extends (infer T)[] | undefined ? T : never) => {
    e.preventDefault();
    e.stopPropagation();
    setEditId((facility as { id: number }).id);
    const f = facility as unknown as typeof EMPTY_FORM & { id: number; capacity?: number | null; isActive?: boolean };
    setForm({
      name: String(f.name ?? ""),
      facilityType: (f.facilityType ?? "PCH") as "PCH" | "ALR",
      licenseNumber: String(f.licenseNumber ?? ""),
      address: String(f.address ?? ""),
      city: String(f.city ?? ""),
      state: String(f.state ?? "PA"),
      zip: String(f.zip ?? ""),
      phone: String(f.phone ?? ""),
      administratorName: String(f.administratorName ?? ""),
      administratorEmail: String(f.administratorEmail ?? ""),
      capacity: f.capacity != null ? String(f.capacity) : "",
      isActive: f.isActive !== false,
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
      facilityType: form.facilityType,
      licenseNumber: form.licenseNumber || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
      state: form.state || undefined,
      zip: form.zip || undefined,
      phone: form.phone || undefined,
      administratorName: form.administratorName || undefined,
      administratorEmail: form.administratorEmail || undefined,
      capacity: form.capacity ? Number(form.capacity) : undefined,
      isActive: form.isActive,
    };
    if (editId) {
      updateFacility({ id: editId, data: payload });
    } else {
      createFacility({ data: payload as unknown as Parameters<typeof createFacility>[0]["data"] });
    }
  };

  const field = (k: keyof FacilityFormData, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1>Facilities</h1>
          <p>View and manage your PCH and ALR facilities.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> Add Facility
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-44 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {facilities?.map(facility => (
            <Link key={facility.id} href={`${basePath}/${facility.id}`}>
              <div className="premium-card p-5 cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group">
                <div className="flex items-start justify-between mb-4">
                  <div className="h-11 w-11 rounded-xl bg-primary/8 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary/70" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {canManage && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-foreground" onClick={(e) => openEdit(e, facility)} aria-label={`Edit ${facility.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteId(facility.id); }}
                          aria-label={`Delete ${facility.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
                  </div>
                </div>

                <h3 className="font-semibold text-[15px] text-foreground mb-2">{facility.name}</h3>

                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className={`text-[10px] font-medium ${
                    facility.facilityType === "ALR"
                      ? "border-violet-200 text-violet-700 bg-violet-50"
                      : "border-blue-200 text-blue-700 bg-blue-50"
                  }`}>
                    {facility.facilityType}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] font-medium ${
                    facility.isActive
                      ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                      : "border-slate-200 text-slate-500 bg-slate-50"
                  }`}>
                    {facility.isActive ? "Active" : "Inactive"}
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
                  {facility.licenseNumber && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">{facility.licenseNumber}</span>
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
          {(!facilities || facilities.length === 0) && (
            <div className="col-span-full flex flex-col items-center justify-center py-16">
              <Building2 className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No facilities found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Add a facility to get started</p>
            </div>
          )}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={o => { if (!o) { setShowForm(false); setEditId(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Facility" : "Add Facility"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Facility Name *</Label>
              <Input value={form.name} onChange={e => field("name", e.target.value)} placeholder="Sunrise Manor" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Type *</Label>
              <Select value={form.facilityType} onValueChange={v => field("facilityType", v as "PCH" | "ALR")}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PCH">PCH</SelectItem>
                  <SelectItem value="ALR">ALR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">License Number</Label>
              <Input value={form.licenseNumber} onChange={e => field("licenseNumber", e.target.value)} placeholder="LIC-0001" className="h-9" />
            </div>
            <div className="col-span-2 space-y-1.5">
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
              <Label className="text-[13px]">Bed Capacity</Label>
              <Input type="number" value={form.capacity} onChange={e => field("capacity", e.target.value)} placeholder="50" min={1} className="h-9" />
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
              onClick={() => { if (deleteId) deleteFacility({ id: deleteId }); }}
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
