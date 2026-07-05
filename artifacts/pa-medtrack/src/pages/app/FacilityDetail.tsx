import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Building2, MapPin, Phone, Users, BookOpen, BarChart3, Clock, XCircle, Pencil, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetFacility, useUpdateFacility, useDeleteFacility } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { FACILITY_TYPES, facilityTypeBadgeClass, type FacilityType } from "@/lib/facilityTypes";

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

const COMPLIANCE_PLACEHOLDER_TEXT =
  "Compliance tracking for this facility will be available once it's migrated to Supabase in the next phase.";

export default function FacilityDetail() {
  const [, params] = useRoute("/app/facilities/:id");
  const id = params?.id;
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const canManage = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  const { data: facility, isLoading: facLoading } = useGetFacility(id);
  const { data: employees, isLoading: empLoading } = useListEmployees({ facilityId: id });

  const { mutate: updateFacility, isPending: updating } = useUpdateFacility();
  const { mutate: deleteFacility, isPending: deleting } = useDeleteFacility();

  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [form, setForm] = useState<FacilityFormData>(EMPTY_FORM);

  const openEdit = () => {
    if (!facility) return;
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
      isActive: facility.is_active,
    });
    setShowEdit(true);
  };

  const field = (k: keyof FacilityFormData, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!facility) return;
    if (!form.name.trim()) {
      toast({ title: "Facility name is required", variant: "destructive" });
      return;
    }
    updateFacility(
      {
        id: facility.id,
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
      },
      {
        onSuccess: () => { toast({ title: "Facility updated" }); setShowEdit(false); },
        onError: (e: Error) => toast({ title: "Failed to update facility", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleDelete = () => {
    if (!facility) return;
    deleteFacility(facility.id, {
      onSuccess: () => {
        toast({ title: "Facility deleted" });
        navigate("/app/facilities");
      },
      onError: (e: Error) => toast({ title: "Failed to delete facility", description: e.message, variant: "destructive" }),
    });
  };

  if (facLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!facility) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Facility not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/app/facilities">Back to Facilities</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/facilities">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{facility.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline" className={facilityTypeBadgeClass(facility.facility_type)}>{facility.facility_type}</Badge>
              <Badge variant={facility.is_active ? "default" : "secondary"}>{facility.is_active ? "Active" : "Inactive"}</Badge>
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowDelete(true)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">License Number</p>
            <p className="font-semibold text-sm">{facility.license_number ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Location</p>
            <div className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="font-semibold text-sm">{[facility.city, facility.state].filter(Boolean).join(", ") || "—"}</p>
            </div>
            {facility.address && (
              <p className="text-xs text-muted-foreground mt-1">{facility.address}{facility.zip ? ` ${facility.zip}` : ""}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Phone</p>
            <div className="flex items-center gap-1">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="font-semibold text-sm">{facility.phone ?? "—"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Administrator</p>
            <p className="font-semibold text-sm">{facility.administrator_name ?? "—"}</p>
            {facility.administrator_email && <p className="text-xs text-muted-foreground truncate">{facility.administrator_email}</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-muted-foreground" /> Training Compliance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-6 text-muted-foreground">
              <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{COMPLIANCE_PLACEHOLDER_TEXT}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-muted-foreground" /> Additional Requirements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-6 text-muted-foreground">
              <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{COMPLIANCE_PLACEHOLDER_TEXT}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-muted-foreground" /> Upcoming Due Dates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-6 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{COMPLIANCE_PLACEHOLDER_TEXT}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <XCircle className="h-4 w-4 text-muted-foreground" /> Recently Expired
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-6 text-muted-foreground">
              <XCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{COMPLIANCE_PLACEHOLDER_TEXT}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Staff ({employees?.length ?? "..."})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {empLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !employees?.length ? (
            <p className="text-sm text-muted-foreground">No staff on record.</p>
          ) : (
            <div className="space-y-2">
              {employees.map(emp => (
                <Link key={emp.id} href={`/app/employees/${emp.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/5 cursor-pointer">
                    <div>
                      <p className="font-medium text-sm">{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs text-muted-foreground">{emp.job_title}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {emp.administers_medications && <Badge variant="outline" className="text-xs">Med Admin</Badge>}
                      {emp.trainer_status && <Badge variant="outline" className="text-xs">Trainer</Badge>}
                      <Badge variant={emp.status === "active" ? "default" : "secondary"} className="text-xs">{emp.status}</Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEdit} onOpenChange={o => { if (!o) setShowEdit(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Facility</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
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
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updating} className="shadow-sm">
              {updating ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Facility</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {facility.name}? This action cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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
