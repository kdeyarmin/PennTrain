import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  useListHelpArticles, useCreateHelpArticle, useUpdateHelpArticle, useDeleteHelpArticle,
  type HelpArticle, type FaqContent, type JobAideContent,
} from "@/hooks/useHelpArticles";
import type { Json } from "@/lib/database.types";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

type ArticleType = "faq" | "job_aide";

interface ArticleFormState {
  articleType: ArticleType;
  category: string;
  title: string;
  isPublished: boolean;
  sortOrder: number;
  answer: string;
  summary: string;
  audience: string;
  steps: string;
  tips: string;
  relatedLabel: string;
  relatedHref: string;
}

const EMPTY_FORM: ArticleFormState = {
  articleType: "faq",
  category: "",
  title: "",
  isPublished: true,
  sortOrder: 0,
  answer: "",
  summary: "",
  audience: "",
  steps: "",
  tips: "",
  relatedLabel: "",
  relatedHref: "",
};

function articleToForm(a: HelpArticle): ArticleFormState {
  if (a.article_type === "faq") {
    const c = a.content as unknown as FaqContent;
    return { ...EMPTY_FORM, articleType: "faq", category: a.category, title: a.title, isPublished: a.is_published, sortOrder: a.sort_order, answer: c.answer };
  }
  const c = a.content as unknown as JobAideContent;
  return {
    ...EMPTY_FORM,
    articleType: "job_aide",
    category: a.category,
    title: a.title,
    isPublished: a.is_published,
    sortOrder: a.sort_order,
    summary: c.summary,
    audience: (c.audience ?? []).join(", "),
    steps: (c.steps ?? []).join("\n"),
    tips: (c.tips ?? []).join("\n"),
    relatedLabel: c.relatedRoute?.label ?? "",
    relatedHref: c.relatedRoute?.href ?? "",
  };
}

function formToContent(form: ArticleFormState): FaqContent | JobAideContent {
  if (form.articleType === "faq") {
    return { answer: form.answer.trim() };
  }
  const steps = form.steps.split("\n").map((s) => s.trim()).filter(Boolean);
  const tips = form.tips.split("\n").map((s) => s.trim()).filter(Boolean);
  const audience = form.audience.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    summary: form.summary.trim(),
    audience,
    steps,
    tips: tips.length ? tips : null,
    relatedRoute: form.relatedLabel.trim() && form.relatedHref.trim()
      ? { label: form.relatedLabel.trim(), href: form.relatedHref.trim() }
      : null,
  };
}

export default function HelpContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<ArticleType>("faq");
  const { data, isLoading } = useListHelpArticles(tab);
  const articles = data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ArticleFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<HelpArticle | null>(null);

  const { mutate: createArticle, isPending: creating } = useCreateHelpArticle();
  const { mutate: updateArticle, isPending: updating } = useUpdateHelpArticle();
  const { mutate: deleteArticle, isPending: deleting } = useDeleteHelpArticle();

  const openNew = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, articleType: tab });
    setDialogOpen(true);
  };

  const openEdit = (a: HelpArticle) => {
    setEditingId(a.id);
    setForm(articleToForm(a));
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.category.trim() || !form.title.trim()) return;
    const content = formToContent(form);
    if (form.articleType === "faq" && !(content as FaqContent).answer) {
      toast({ title: "Can't save", description: "An FAQ needs an answer.", variant: "destructive" });
      return;
    }
    if (form.articleType === "job_aide") {
      const jobAide = content as JobAideContent;
      if (!jobAide.summary) {
        toast({ title: "Can't save", description: "A job aide needs a summary.", variant: "destructive" });
        return;
      }
      if (!jobAide.steps.length) {
        toast({ title: "Can't save", description: "A job aide needs at least one step.", variant: "destructive" });
        return;
      }
    }

    if (editingId) {
      updateArticle(
        {
          id: editingId,
          category: form.category.trim(),
          title: form.title.trim(),
          sort_order: form.sortOrder,
          is_published: form.isPublished,
          content: content as unknown as Json,
        },
        {
          onSuccess: () => { toast({ title: "Article updated" }); setDialogOpen(false); },
          onError: (e: Error) => toast({ title: "Failed to update article", description: e.message, variant: "destructive" }),
        }
      );
    } else {
      createArticle(
        {
          article_type: form.articleType,
          category: form.category.trim(),
          title: form.title.trim(),
          sort_order: form.sortOrder,
          is_published: form.isPublished,
          content: content as unknown as Json,
          created_by: user?.id ?? null,
        },
        {
          onSuccess: () => { toast({ title: "Article created" }); setDialogOpen(false); },
          onError: (e: Error) => toast({ title: "Failed to create article", description: e.message, variant: "destructive" }),
        }
      );
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteArticle(deleteTarget.id, {
      onSuccess: () => { toast({ title: "Article deleted" }); setDeleteTarget(null); },
      onError: (e: Error) => toast({ title: "Failed to delete article", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Help Center Content</h1>
        <p className="text-muted-foreground">Manage the FAQ and Job Aide articles shown in every organization's Help Center.</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ArticleType)}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <TabsList>
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="job_aide">Job Aides</TabsTrigger>
          </TabsList>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> New Article</Button>
        </div>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {isLoading ? (
                <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}</div>
              ) : !articles.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">No articles yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {articles.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-sm">{a.category}</TableCell>
                        <TableCell className="font-medium text-sm max-w-md truncate">{a.title}</TableCell>
                        <TableCell className="text-sm">{a.sort_order}</TableCell>
                        <TableCell>
                          <Badge variant={a.is_published ? "default" : "outline"} className="text-xs">
                            {a.is_published ? "Published" : "Draft"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(a)} aria-label="Edit article">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(a)} aria-label="Delete article">
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
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit" : "New"} {form.articleType === "faq" ? "FAQ" : "Job Aide"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Getting Started & Roles" />
            </div>
            <div className="space-y-1.5">
              <Label>{form.articleType === "faq" ? "Question" : "Title"}</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>

            {form.articleType === "faq" ? (
              <div className="space-y-1.5">
                <Label>Answer</Label>
                <Textarea rows={5} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Summary</Label>
                  <Textarea rows={2} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Audience (comma-separated roles)</Label>
                  <Input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="org_admin, facility_manager" />
                </div>
                <div className="space-y-1.5">
                  <Label>Steps (one per line)</Label>
                  <Textarea rows={6} value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tips (one per line, optional)</Label>
                  <Textarea rows={3} value={form.tips} onChange={(e) => setForm({ ...form, tips: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Related Link Label (optional)</Label>
                    <Input value={form.relatedLabel} onChange={(e) => setForm({ ...form, relatedLabel: e.target.value })} placeholder="Go to Employees" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Related Link Path (optional)</Label>
                    <Input value={form.relatedHref} onChange={(e) => setForm({ ...form, relatedHref: e.target.value })} placeholder="/app/employees" />
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sort Order</Label>
                <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Switch checked={form.isPublished} onCheckedChange={(v) => setForm({ ...form, isPublished: v })} />
                <Label>Published</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={creating || updating}>
              {editingId ? "Save Changes" : "Create Article"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this article?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be permanently removed from the Help Center. This can't be undone.
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
