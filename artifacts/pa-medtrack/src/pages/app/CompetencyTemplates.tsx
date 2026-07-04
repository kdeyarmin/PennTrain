import { useState } from "react";
import {
  useListCompetencyTemplates,
  useCreateCompetencyTemplate,
  useUpdateCompetencyTemplate,
  useDeleteCompetencyTemplate,
  useListCompetencyTemplateItems,
  useAddCompetencyTemplateItem,
  useUpdateCompetencyTemplateItem,
  useRemoveCompetencyTemplateItem,
  type CompetencyTemplate,
  type CompetencyTemplateItem,
} from "@/hooks/useCompetencies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, Search, Plus, Pencil, Trash2, ListChecks, ArrowUp, ArrowDown, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface TemplateFormData {
  name: string;
  description: string;
}

const EMPTY_FORM: TemplateFormData = { name: "", description: "" };

// ---------------------------------------------------------------------------
// Checklist item management for a single template.
//
// TrainingPlans.tsx's plan-items panel is this app's other ordered sub-item
// list (training_plan_items, also keyed by sort_order) -- this mirrors its
// convention: up/down buttons (no drag-and-drop dependency in this codebase)
// that swap sort_order with the neighboring row via mutateAsync + Promise.all,
// with a busy-state guard so a second click can't race an in-flight swap.
// ---------------------------------------------------------------------------
function ManageItemsDialog({ template, onClose }: { template: CompetencyTemplate | null; onClose: () => void }) {
  const { toast } = useToast();
  const [newItemText, setNewItemText] = useState("");
  const [deleteItem, setDeleteItem] = useState<CompetencyTemplateItem | null>(null);
  const [reordering, setReordering] = useState(false);

  const { data: items, isLoading } = useListCompetencyTemplateItems(template?.id);
  const { mutate: addItem, isPending: adding } = useAddCompetencyTemplateItem();
  const { mutateAsync: updateItem } = useUpdateCompetencyTemplateItem();
  const { mutate: removeItem, isPending: removing } = useRemoveCompetencyTemplateItem();

  const sortedItems = items ?? [];

  const handleAdd = () => {
    if (!template || !newItemText.trim()) return;
    const nextSort = (sortedItems.reduce((max, i) => Math.max(max, i.sort_order), -1)) + 1;
    addItem(
      { template_id: template.id, item_text: newItemText.trim(), sort_order: nextSort },
      {
        onSuccess: () => setNewItemText(""),
        onError: (e: Error) => toast({ title: "Failed to add item", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = sortedItems[index];
    const neighbor = sortedItems[index + direction];
    if (!target || !neighbor) return;
    setReordering(true);
    try {
      await Promise.all([
        updateItem({ id: target.id, sort_order: neighbor.sort_order }),
        updateItem({ id: neighbor.id, sort_order: target.sort_order }),
      ]);
    } catch (e) {
      toast({ title: "Failed to reorder items", description: (e as Error).message, variant: "destructive" });
    } finally {
      setReordering(false);
    }
  };

  const handleDelete = () => {
    if (!deleteItem || !template) return;
    removeItem(
      { id: deleteItem.id, templateId: template.id },
      {
        onSuccess: () => { toast({ title: "Item removed" }); setDeleteItem(null); },
        onError: (e: Error) => toast({ title: "Failed to remove item", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={!!template} onOpenChange={(o) => { if (!o) { setNewItemText(""); onClose(); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Checklist Items — {template?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : sortedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No checklist items yet. Add the first one below.</p>
          ) : (
            <div className="space-y-1.5">
              {sortedItems.map((item, idx) => (
                <div key={item.id} className="flex items-center gap-2 p-2.5 rounded-lg border">
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{idx + 1}.</span>
                  <span className="flex-1 text-sm">{item.item_text}</span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      disabled={idx === 0 || reordering}
                      onClick={() => handleMove(idx, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      disabled={idx === sortedItems.length - 1 || reordering}
                      onClick={() => handleMove(idx, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteItem(item)}
                      aria-label="Remove item"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-2">
            <Input
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="e.g. Washes hands before administering medication"
              className="h-9"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
            />
            <Button size="sm" className="h-9 shrink-0" disabled={!newItemText.trim() || adding} onClick={handleAdd}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={!!deleteItem} onOpenChange={(o) => { if (!o) setDeleteItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Checklist Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{deleteItem?.item_text}"? Any existing completed evaluations keep their
              recorded result for this item, but it will no longer appear on new evaluations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

export default function CompetencyTemplates() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editTemplate, setEditTemplate] = useState<CompetencyTemplate | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<CompetencyTemplate | null>(null);
  const [managingTemplate, setManagingTemplate] = useState<CompetencyTemplate | null>(null);
  const [form, setForm] = useState<TemplateFormData>(EMPTY_FORM);

  const { user } = useAuth();
  const { toast } = useToast();

  // Matches the write-access role set in the competency_templates RLS policies
  // (org_admin, trainer) -- same pair CourseDetail.tsx/Courses.tsx use for the
  // analogous content-catalog authoring pages. facility_manager can reach this
  // page (see App.tsx's ORG_ROLES) but is read-only here, same as on Courses.
  const canManage = user?.role === "org_admin" || user?.role === "trainer";

  const { data: templates, isLoading } = useListCompetencyTemplates();
  const { mutate: createTemplate, isPending: creating } = useCreateCompetencyTemplate();
  const { mutate: updateTemplate, isPending: updatingTemplate } = useUpdateCompetencyTemplate();
  const { mutate: deleteTemplateMutate, isPending: deleting } = useDeleteCompetencyTemplate();

  const allTemplates = templates ?? [];
  const filtered = allTemplates.filter((t) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return t.name.toLowerCase().includes(s) || (t.description ?? "").toLowerCase().includes(s);
  });

  const openCreate = () => {
    setEditTemplate(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (t: CompetencyTemplate) => {
    setEditTemplate(t);
    setForm({ name: t.name, description: t.description ?? "" });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (editTemplate) {
      updateTemplate(
        { id: editTemplate.id, name: form.name.trim(), description: form.description || null },
        {
          onSuccess: () => { toast({ title: "Template updated" }); setShowForm(false); setEditTemplate(null); },
          onError: (e: Error) => toast({ title: "Failed to update template", description: e.message, variant: "destructive" }),
        },
      );
    } else if (user?.organizationId) {
      createTemplate(
        { name: form.name.trim(), description: form.description || null, organization_id: user.organizationId },
        {
          onSuccess: () => { toast({ title: "Template created" }); setShowForm(false); setForm(EMPTY_FORM); },
          onError: (e: Error) => toast({ title: "Failed to create template", description: e.message, variant: "destructive" }),
        },
      );
    }
  };

  const handleDelete = () => {
    if (!deleteTemplate) return;
    deleteTemplateMutate(deleteTemplate.id, {
      onSuccess: () => { toast({ title: "Template deleted" }); setDeleteTemplate(null); },
      onError: (e: Error) => toast({ title: "Failed to delete template", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1>Competency Templates</h1>
          <p>Define reusable competency checklists that evaluators fill out for employees.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> New Template
          </Button>
        )}
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 bg-card"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ClipboardCheck className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No competency templates yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {canManage ? "Create one to start building competency checklists." : "Try adjusting your search."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Origin</th>
                  <th className="w-56" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="font-medium text-foreground">{t.name}</span>
                      {t.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{t.description}</p>
                      )}
                    </td>
                    <td>
                      {t.organization_id === null ? (
                        <Badge variant="outline" className="text-[10px] font-medium">System</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] font-medium bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">Your Org</Badge>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5 justify-end">
                        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground" onClick={() => setManagingTemplate(t)}>
                          <ListChecks className="mr-1.5 h-3.5 w-3.5" /> Items
                        </Button>
                        {canManage && (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEdit(t)} aria-label={`Edit ${t.name}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTemplate(t)} aria-label={`Delete ${t.name}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <ClipboardCheck className="h-4 w-4" />
        <span>{filtered.length} template{filtered.length !== 1 ? "s" : ""} total</span>
      </div>

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) { setShowForm(false); setEditTemplate(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTemplate ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Medication Administration Competency"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What this checklist verifies and when it should be used"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditTemplate(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating || updatingTemplate} className="shadow-sm">
              {creating || updatingTemplate ? "Saving..." : editTemplate ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTemplate} onOpenChange={(o) => { if (!o) setDeleteTemplate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTemplate?.name}"? This also removes its checklist items. If any
              completed competency records still reference this template, the database will reject the delete --
              those records must stay auditable, so this template can't be removed while they exist.
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

      <ManageItemsDialog template={managingTemplate} onClose={() => setManagingTemplate(null)} />
    </div>
  );
}
