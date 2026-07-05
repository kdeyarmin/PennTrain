import { useState } from "react";
import {
  useListPackages,
  useCreatePackage,
  useUpdatePackage,
  useDeletePackage,
  type Package,
} from "@/hooks/usePackages";
import type { Json } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Package as PackageIcon, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PackageFormData {
  name: string;
  isActive: boolean;
  sortOrder: string;
  facilityLimit: string;
  learnerLimit: string;
  priceMonthly: string;
  featuresJson: string;
}

const EMPTY_FORM: PackageFormData = {
  name: "",
  isActive: true,
  sortOrder: "0",
  facilityLimit: "",
  learnerLimit: "",
  priceMonthly: "",
  featuresJson: "{}",
};

function centsToDollarsDisplay(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}/mo`;
}

export default function Packages() {
  const { toast } = useToast();
  const { data: packages, isLoading } = useListPackages();
  const { mutate: createPackage, isPending: creating } = useCreatePackage();
  const { mutate: updatePackage, isPending: updating } = useUpdatePackage();
  const { mutate: deletePackage, isPending: deleting } = useDeletePackage();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<PackageFormData>(EMPTY_FORM);

  const field = <K extends keyof PackageFormData>(k: K, v: PackageFormData[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (pkg: Package) => {
    setEditId(pkg.id);
    setForm({
      name: pkg.name,
      isActive: pkg.is_active,
      sortOrder: String(pkg.sort_order ?? 0),
      facilityLimit: pkg.facility_limit === null ? "" : String(pkg.facility_limit),
      learnerLimit: pkg.learner_limit === null ? "" : String(pkg.learner_limit),
      priceMonthly: pkg.price_monthly_cents === null ? "" : (pkg.price_monthly_cents / 100).toFixed(2),
      featuresJson: pkg.features === null ? "{}" : JSON.stringify(pkg.features, null, 2),
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast({ title: "Package name is required", variant: "destructive" });
      return;
    }

    let features: Json = null;
    if (form.featuresJson.trim()) {
      try {
        features = JSON.parse(form.featuresJson) as Json;
      } catch {
        toast({ title: "Invalid JSON in features", description: "Please fix the features field before saving.", variant: "destructive" });
        return;
      }
    }

    const sortOrder = form.sortOrder.trim() ? parseInt(form.sortOrder, 10) : 0;
    const facilityLimit = form.facilityLimit.trim() ? parseInt(form.facilityLimit, 10) : null;
    const learnerLimit = form.learnerLimit.trim() ? parseInt(form.learnerLimit, 10) : null;
    const priceMonthlyCents = form.priceMonthly.trim() ? Math.round(parseFloat(form.priceMonthly) * 100) : null;

    const payload = {
      name: form.name.trim(),
      is_active: form.isActive,
      sort_order: sortOrder,
      facility_limit: facilityLimit,
      learner_limit: learnerLimit,
      price_monthly_cents: priceMonthlyCents,
      features,
    };

    if (editId) {
      updatePackage(
        { id: editId, ...payload },
        {
          onSuccess: () => { toast({ title: "Package updated" }); setShowForm(false); setEditId(null); },
          onError: (e: Error) => toast({ title: "Failed to update package", description: e.message, variant: "destructive" }),
        },
      );
    } else {
      createPackage(payload, {
        onSuccess: () => { toast({ title: "Package created" }); setShowForm(false); setForm(EMPTY_FORM); },
        onError: (e: Error) => toast({ title: "Failed to create package", description: e.message, variant: "destructive" }),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Packages</h1>
          <p className="text-muted-foreground">Manage subscription packages available to organizations.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Add Package
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Packages</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : !packages?.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <PackageIcon className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium text-muted-foreground">No packages yet</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Add a package to make it available to organizations.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Facility Limit</TableHead>
                  <TableHead>Learner Limit</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.map(pkg => (
                  <TableRow key={pkg.id}>
                    <TableCell className="font-medium">{pkg.name}</TableCell>
                    <TableCell>
                      <Badge variant={pkg.is_active ? "default" : "secondary"}>
                        {pkg.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>{pkg.sort_order}</TableCell>
                    <TableCell>{pkg.facility_limit ?? "Unlimited"}</TableCell>
                    <TableCell>{pkg.learner_limit ?? "Unlimited"}</TableCell>
                    <TableCell>{centsToDollarsDisplay(pkg.price_monthly_cents)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(pkg)} aria-label={`Edit ${pkg.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteId(pkg.id)}
                          aria-label={`Delete ${pkg.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={o => { if (!o) { setShowForm(false); setEditId(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Package" : "Add Package"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Name *</Label>
              <Input value={form.name} onChange={e => field("name", e.target.value)} placeholder="Professional" className="h-9" />
            </div>
            <div className="col-span-2 flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive packages are hidden from organization signup.</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={v => field("isActive", v)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Sort Order</Label>
              <Input type="number" value={form.sortOrder} onChange={e => field("sortOrder", e.target.value)} placeholder="0" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Price / Month ($)</Label>
              <Input type="number" step="0.01" min="0" value={form.priceMonthly} onChange={e => field("priceMonthly", e.target.value)} placeholder="49.00" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Facility Limit</Label>
              <Input type="number" min="0" value={form.facilityLimit} onChange={e => field("facilityLimit", e.target.value)} placeholder="Unlimited" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Learner Limit</Label>
              <Input type="number" min="0" value={form.learnerLimit} onChange={e => field("learnerLimit", e.target.value)} placeholder="Unlimited" className="h-9" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Features (JSON)</Label>
              <Textarea
                value={form.featuresJson}
                onChange={e => field("featuresJson", e.target.value)}
                placeholder='{"reports": true, "sso": false}'
                className="font-mono text-xs min-h-[100px]"
              />
              <p className="text-xs text-muted-foreground/60">Free-form JSON describing feature flags for this package.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating || updating} className="shadow-sm">
              {creating || updating ? "Saving..." : editId ? "Save Changes" : "Create Package"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={o => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Package</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this package? This cannot be undone. Packages currently assigned to an
              organization cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteId) return;
                deletePackage(deleteId, {
                  onSuccess: () => { toast({ title: "Package deleted" }); setDeleteId(null); },
                  onError: (e: Error) => toast({ title: "Failed to delete package", description: e.message, variant: "destructive" }),
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
