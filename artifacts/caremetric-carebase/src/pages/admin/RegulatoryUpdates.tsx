import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FACILITY_TYPES } from "@/lib/facilityTypes";
import { formatDateForDisplay } from "@/lib/dateUtils";
import {
  categoryLabel,
  REGULATORY_CATEGORIES,
  slugifyTitle,
  STATUS_LABELS,
  type RegulatoryUpdateStatus,
} from "@/lib/regulatoryUpdates";
import {
  useAdminRegulatoryUpdates,
  useCreateRegulatoryUpdate,
  useDeleteRegulatoryUpdate,
  useUpdateRegulatoryUpdate,
  type AdminRegulatoryUpdate,
  type RegulatoryUpdateInput,
} from "@/hooks/useRegulatoryUpdates";

interface FormState {
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  facilityTypes: string[];
  citation: string;
  state: string;
  sourceName: string;
  sourceUri: string;
  effectiveDate: string;
  status: RegulatoryUpdateStatus;
  isFeatured: boolean;
  // Carried through so editing a published row preserves its original publish date instead of
  // restamping it to "now" on every save; blank for never-published rows.
  publishedAt: string;
}

const EMPTY_FORM: FormState = {
  slug: "",
  title: "",
  summary: "",
  body: "",
  category: "update",
  facilityTypes: [],
  citation: "",
  state: "PA",
  sourceName: "",
  sourceUri: "",
  effectiveDate: "",
  status: "draft",
  isFeatured: false,
  publishedAt: "",
};

function updateToForm(u: AdminRegulatoryUpdate): FormState {
  return {
    slug: u.slug,
    title: u.title,
    summary: u.summary,
    body: u.body ?? "",
    category: u.category,
    facilityTypes: u.facility_types ?? [],
    citation: u.citation ?? "",
    state: u.state ?? "PA",
    sourceName: u.source_name ?? "",
    sourceUri: u.source_uri ?? "",
    effectiveDate: u.effective_date ?? "",
    status: u.status,
    isFeatured: u.is_featured,
    publishedAt: u.published_at ?? "",
  };
}

function formToInput(form: FormState): RegulatoryUpdateInput {
  return {
    slug: form.slug.trim(),
    title: form.title.trim(),
    summary: form.summary.trim(),
    body: form.body.trim() || null,
    category: form.category,
    facility_types: form.facilityTypes,
    citation: form.citation.trim() || null,
    state: form.state.trim() || "PA",
    source_name: form.sourceName.trim() || null,
    source_uri: form.sourceUri.trim() || null,
    effective_date: form.effectiveDate || null,
    status: form.status,
    is_featured: form.isFeatured,
    // Preserved existing value on edits; withPublishTimestamp() only stamps "now" when a row is
    // being published for the first time (published_at still null).
    published_at: form.publishedAt || null,
  };
}

const STATUS_BADGE_VARIANT: Record<RegulatoryUpdateStatus, "default" | "outline" | "secondary"> = {
  published: "default",
  draft: "outline",
  archived: "secondary",
};

export default function RegulatoryUpdates() {
  const { toast } = useToast();
  const { data, isLoading } = useAdminRegulatoryUpdates();
  const updates = data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminRegulatoryUpdate | null>(null);
  // Only auto-derive the slug from the title while creating a new entry and the editor hasn't
  // typed a custom slug, so editing an existing entry never silently rewrites its stable slug.
  const [slugTouched, setSlugTouched] = useState(false);

  const { mutate: createUpdate, isPending: creating } = useCreateRegulatoryUpdate();
  const { mutate: updateUpdate, isPending: updating } = useUpdateRegulatoryUpdate();
  const { mutate: deleteUpdate, isPending: deleting } = useDeleteRegulatoryUpdate();

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSlugTouched(false);
    setDialogOpen(true);
  };

  const openEdit = (u: AdminRegulatoryUpdate) => {
    setEditingId(u.id);
    setForm(updateToForm(u));
    setSlugTouched(true);
    setDialogOpen(true);
  };

  const setTitle = (title: string) => {
    setForm((prev) => ({
      ...prev,
      title,
      slug: !editingId && !slugTouched ? slugifyTitle(title) : prev.slug,
    }));
  };

  const toggleFacilityType = (code: string, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      facilityTypes: checked
        ? Array.from(new Set([...prev.facilityTypes, code]))
        : prev.facilityTypes.filter((c) => c !== code),
    }));
  };

  const handleSave = () => {
    const input = formToInput(form);
    if (!input.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
      toast({ title: "Can't save", description: "Slug must be lowercase letters, numbers, and hyphens.", variant: "destructive" });
      return;
    }
    if (input.title.length < 3) {
      toast({ title: "Can't save", description: "A title is required.", variant: "destructive" });
      return;
    }
    if (input.summary.length < 3) {
      toast({ title: "Can't save", description: "A summary is required.", variant: "destructive" });
      return;
    }

    if (editingId) {
      updateUpdate(
        { id: editingId, input },
        {
          onSuccess: () => { toast({ title: "Update saved" }); setDialogOpen(false); },
          onError: (e: Error) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
        },
      );
    } else {
      createUpdate(input, {
        onSuccess: () => { toast({ title: "Update created" }); setDialogOpen(false); },
        onError: (e: Error) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
      });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteUpdate(deleteTarget.id, {
      onSuccess: () => { toast({ title: "Update deleted" }); setDeleteTarget(null); },
      onError: (e: Error) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Regulatory Updates</h1>
          <p className="text-muted-foreground">
            Track new regulations, clarifications, and guidance. Published entries appear on the
            public <span className="font-medium">/regulatory-updates</span> page and feed the email
            newsletter.
          </p>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> New Update</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}</div>
          ) : !updates.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">No regulatory updates yet. Create the first one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {updates.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium text-sm max-w-md">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{u.title}</span>
                        {u.is_featured && <Badge variant="secondary" className="text-[10px]">Featured</Badge>}
                      </div>
                      <span className="block text-xs text-muted-foreground font-mono">{u.slug}</span>
                    </TableCell>
                    <TableCell className="text-sm">{categoryLabel(u.category)}</TableCell>
                    <TableCell className="text-sm">{u.effective_date ? formatDateForDisplay(u.effective_date, { month: "short", day: "numeric", year: "numeric" }) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE_VARIANT[u.status]} className="text-xs">
                        {STATUS_LABELS[u.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(u)} aria-label="Edit update">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(u)} aria-label="Delete update">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit" : "New"} regulatory update</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PCH annual training stays at 12 hours" />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input
                value={form.slug}
                onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: e.target.value }); }}
                placeholder="pch-annual-training-12-hours"
              />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens. Stable identifier — avoid changing it after publishing.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Summary</Label>
              <Textarea rows={2} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="One or two sentences shown in the feed and email." />
            </div>
            <div className="space-y-1.5">
              <Label>Body (optional)</Label>
              <Textarea rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Full explanation. Separate paragraphs with a blank line." />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REGULATORY_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as RegulatoryUpdateStatus })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABELS) as RegulatoryUpdateStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Facility types</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {FACILITY_TYPES.map((ft) => (
                  <label key={ft.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.facilityTypes.includes(ft.value)}
                      onCheckedChange={(checked) => toggleFacilityType(ft.value, checked === true)}
                    />
                    {ft.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Leave all unchecked if it applies to every facility type.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Citation (optional)</Label>
                <Input value={form.citation} onChange={(e) => setForm({ ...form, citation: e.target.value })} placeholder="55 Pa. Code § 2600.65" />
              </div>
              <div className="space-y-1.5">
                <Label>Effective date (optional)</Label>
                <Input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Source name (optional)</Label>
                <Input value={form.sourceName} onChange={(e) => setForm({ ...form, sourceName: e.target.value })} placeholder="PA Department of Human Services" />
              </div>
              <div className="space-y-1.5">
                <Label>Source URL (optional)</Label>
                <Input value={form.sourceUri} onChange={(e) => setForm({ ...form, sourceUri: e.target.value })} placeholder="https://www.pacodeandbulletin.gov/..." />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Switch checked={form.isFeatured} onCheckedChange={(v) => setForm({ ...form, isFeatured: v })} />
                <Label>Feature at top of feed</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={creating || updating}>
              {editingId ? "Save changes" : "Create update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this update?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be permanently removed. If it&apos;s published, it will
              disappear from the public feed. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
