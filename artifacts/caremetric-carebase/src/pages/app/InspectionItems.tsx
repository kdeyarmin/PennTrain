import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useCreateInspectionItem, useUpdateInspectionItem, useDeleteInspectionItem,
  type InspectionItem,
} from "@/hooks/useInspectionItems";
import { usePaginatedDomainList } from "@/hooks/usePaginatedDomainLists";
import { useListFacilities } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { Flame, ChevronLeft, ChevronRight, Plus, Pencil, Search, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 15;

const ITEM_TYPE_OPTIONS: Array<{ value: InspectionItem["item_type"]; label: string; kind: InspectionItem["item_kind"] }> = [
  { value: "generator", label: "Emergency Generator", kind: "equipment" },
  { value: "fire_extinguisher", label: "Fire Extinguisher", kind: "equipment" },
  { value: "fire_alarm_system", label: "Fire Alarm System", kind: "equipment" },
  { value: "sprinkler_system", label: "Sprinkler System", kind: "equipment" },
  { value: "smoke_detector", label: "Smoke Detector", kind: "equipment" },
  { value: "emergency_lighting", label: "Emergency Lighting", kind: "equipment" },
  { value: "elevator", label: "Elevator", kind: "equipment" },
  { value: "other_equipment", label: "Other Equipment", kind: "equipment" },
  { value: "fire_drill_program", label: "Fire Drill Program", kind: "procedural" },
  { value: "emergency_prep_plan_review", label: "Emergency Preparedness Plan Review", kind: "procedural" },
  { value: "evacuation_time_letter", label: "Fire-Safety-Expert Evacuation Time Letter", kind: "procedural" },
  { value: "emergency_supply_check", label: "Emergency 3-Day Supply Check", kind: "procedural" },
  { value: "other_procedural", label: "Other Procedural Requirement", kind: "procedural" },
];

function itemTypeLabel(type: string): string {
  return ITEM_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type.replace(/_/g, " ");
}

interface ItemFormData {
  facilityId: string;
  itemType: InspectionItem["item_type"];
  label: string;
  locationDetail: string;
  manufacturer: string;
  modelNumber: string;
  serialNumber: string;
  installDate: string;
  inspectionIntervalDays: string;
  notes: string;
}

const EMPTY_FORM: ItemFormData = {
  facilityId: "", itemType: "fire_extinguisher", label: "", locationDetail: "",
  manufacturer: "", modelNumber: "", serialNumber: "", installDate: "",
  inspectionIntervalDays: "30", notes: "",
};

// Fire drills are monthly (55 Pa. Code 2600.132); everything else defaults to an annual cadence
// when an administrator switches the type selector, saving a manual edit for the common case.
const DEFAULT_INTERVAL_DAYS: Partial<Record<InspectionItem["item_type"], number>> = {
  fire_drill_program: 30,
  emergency_prep_plan_review: 365,
  evacuation_time_letter: 365,
  emergency_supply_check: 365,
};

const INSPECTION_ITEMS_URL_DEFAULTS = { search: "", facility: "all", kind: "all", status: "all", page: "1" };

export default function InspectionItems() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [urlState, setUrlState] = useUrlState(INSPECTION_ITEMS_URL_DEFAULTS);
  const [search, setSearch] = useState(urlState.search);
  const page = Math.max(1, Number(urlState.page) || 1);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<InspectionItem | null>(null);
  const [form, setForm] = useState<ItemFormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<InspectionItem | null>(null);

  // Matches inspection_items insert/update RLS -- trainer included (unlike credentials/incidents),
  // since physical-plant compliance is the least sensitive of the three new modules.
  const canManage = ["org_admin", "facility_manager", "trainer"].includes(user?.role ?? "");
  // inspection_items_delete is narrower than insert/update -- org_admin only -- so
  // facility_manager/trainer must not be shown a delete action that will always fail.
  const canDelete = user?.role === "org_admin";

  const { data: facilities } = useListFacilities();
  const { data: itemsPage, isLoading } = usePaginatedDomainList<InspectionItem>("inspection_items", {
    facilityId: urlState.facility !== "all" ? urlState.facility : undefined,
    itemKind: urlState.kind !== "all" ? urlState.kind : undefined,
    status: urlState.status !== "all" ? urlState.status : undefined,
    search: urlState.search,
    page,
    pageSize: PAGE_SIZE,
  });
  const items = itemsPage?.rows ?? [];
  const totalCount = itemsPage?.count ?? 0;

  const { mutate: createItem, isPending: creating } = useCreateInspectionItem();
  const { mutate: updateItem, isPending: updating } = useUpdateInspectionItem();
  const { mutate: deleteItem, isPending: deleting } = useDeleteInspectionItem();

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

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Auto-fill the create dialog's Facility field when the user is scoped to exactly one facility
  // (e.g. a facility_manager) -- saves a needless click every time. Guarded on an empty facilityId,
  // so it's a no-op both for multi-facility orgs and when editing (the field is already populated).
  useEffect(() => {
    if (!showForm || facilities?.length !== 1) return;
    const soleId = facilities[0].id;
    setForm((f) => (f.facilityId ? f : { ...f, facilityId: soleId }));
  }, [showForm, facilities]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (item: InspectionItem) => {
    setEditing(item);
    setForm({
      facilityId: item.facility_id, itemType: item.item_type, label: item.label,
      locationDetail: item.location_detail ?? "", manufacturer: item.manufacturer ?? "",
      modelNumber: item.model_number ?? "", serialNumber: item.serial_number ?? "",
      installDate: item.install_date ?? "", inspectionIntervalDays: String(item.inspection_interval_days),
      notes: item.notes ?? "",
    });
    setShowForm(true);
  };

  const field = (k: keyof ItemFormData, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    if (!form.facilityId || !form.label.trim()) {
      toast({ title: "Facility and label are required", variant: "destructive" });
      return;
    }
    const facility = facilityById.get(form.facilityId);
    if (!facility) return;
    const kind = ITEM_TYPE_OPTIONS.find((o) => o.value === form.itemType)?.kind ?? "equipment";

    const payload = {
      organization_id: facility.organization_id,
      facility_id: facility.id,
      item_kind: kind,
      item_type: form.itemType,
      label: form.label.trim(),
      location_detail: form.locationDetail || null,
      manufacturer: form.manufacturer || null,
      model_number: form.modelNumber || null,
      serial_number: form.serialNumber || null,
      install_date: form.installDate || null,
      inspection_interval_days: Number(form.inspectionIntervalDays) || 30,
      notes: form.notes || null,
    };

    if (editing) {
      updateItem({ id: editing.id, ...payload }, {
        onSuccess: () => { toast({ title: "Inspection item updated" }); setShowForm(false); },
        onError: (e: Error) => toast({ title: "Failed to update item", description: e.message, variant: "destructive" }),
      });
    } else {
      createItem(payload, {
        onSuccess: () => { toast({ title: "Inspection item added" }); setShowForm(false); },
        onError: (e: Error) => toast({ title: "Failed to add item", description: e.message, variant: "destructive" }),
      });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteItem(deleteTarget.id, {
      onSuccess: () => { toast({ title: "Inspection item deleted" }); setDeleteTarget(null); },
      onError: (e: Error) => toast({ title: "Failed to delete item", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Inspections &amp; Equipment</h1>
          <p>Track the fire-drill program, life-safety equipment, and emergency-preparedness requirements for each facility.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> Add Item
          </Button>
        )}
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search inspection items..."
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
          <Select value={urlState.kind} onValueChange={(v) => setUrlState({ kind: v, page: "1" })}>
            <SelectTrigger className="w-40 h-9 bg-card"><SelectValue placeholder="All Kinds" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Kinds</SelectItem>
              <SelectItem value="equipment">Equipment</SelectItem>
              <SelectItem value="procedural">Procedural</SelectItem>
            </SelectContent>
          </Select>
          <Select value={urlState.status} onValueChange={(v) => setUrlState({ status: v, page: "1" })}>
            <SelectTrigger className="w-40 h-9 bg-card"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["compliant", "due_soon", "expired", "missing"].map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Flame className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No inspection items found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {canManage ? "Add an item to get started." : "Try adjusting your filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Facility</th>
                    <th>Item</th>
                    <th>Type</th>
                    <th>Next Due</th>
                    <th>Status</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="text-muted-foreground">{facilityById.get(item.facility_id)?.name ?? "—"}</td>
                      <td>
                        <Link href={`/app/inspections/${item.id}`} className="font-medium text-primary hover:underline">{item.label}</Link>
                      </td>
                      <td className="text-muted-foreground">{itemTypeLabel(item.item_type)}</td>
                      <td className="text-muted-foreground">{item.next_due_date ?? "—"}</td>
                      <td><StatusBadge status={item.status} type="training" /></td>
                      <td>
                        {(canManage || canDelete) && (
                          <div className="flex items-center gap-1">
                            {canManage && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(item)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Inspection Item" : "Add Inspection Item"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Facility *</Label>
              <Select value={form.facilityId} onValueChange={(v) => field("facilityId", v)} disabled={!!editing}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select facility" /></SelectTrigger>
                <SelectContent>
                  {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Type *</Label>
              <Select
                value={form.itemType}
                onValueChange={(v) => {
                  field("itemType", v);
                  const defaultDays = DEFAULT_INTERVAL_DAYS[v as InspectionItem["item_type"]];
                  if (defaultDays && !editing) field("inspectionIntervalDays", String(defaultDays));
                }}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ITEM_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Label *</Label>
              <Input value={form.label} onChange={(e) => field("label", e.target.value)} placeholder="e.g. Extinguisher — 2nd Floor Hallway" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Location</Label>
              <Input value={form.locationDetail} onChange={(e) => field("locationDetail", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Inspection Interval (days) *</Label>
              <Input type="number" min={1} value={form.inspectionIntervalDays} onChange={(e) => field("inspectionIntervalDays", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Manufacturer</Label>
              <Input value={form.manufacturer} onChange={(e) => field("manufacturer", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Model Number</Label>
              <Input value={form.modelNumber} onChange={(e) => field("modelNumber", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Serial Number</Label>
              <Input value={form.serialNumber} onChange={(e) => field("serialNumber", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Install Date</Label>
              <Input type="date" value={form.installDate} onChange={(e) => field("installDate", e.target.value)} className="h-9" />
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => field("notes", e.target.value)} placeholder="Optional notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating || updating} className="shadow-sm">
              {creating || updating ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Inspection Item</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this item and its inspection history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
