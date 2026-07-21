import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  useCreatePolicyDocument, type PolicyDocumentInsert,
} from "@/hooks/usePolicyDocuments";
import { usePaginatedDomainList } from "@/hooks/usePaginatedDomainLists";
import { useUrlState } from "@/hooks/useUrlState";
import { QueryError } from "@/components/QueryState";
import type { Tables } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FileSignature, Plus, ChevronRight } from "lucide-react";

function NewPolicyDocumentDialog() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { mutateAsync: createDocument, isPending } = useCreatePolicyDocument();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");

  const reset = () => { setTitle(""); setDescription(""); setCategory(""); };

  const handleCreate = async () => {
    if (!title.trim() || !user?.organizationId) return;
    const payload: PolicyDocumentInsert = {
      organization_id: user.organizationId,
      title: title.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      created_by: user.id,
    };
    try {
      await createDocument(payload);
      toast({ title: "Policy document created", description: "Upload a version to get started." });
      reset();
      setOpen(false);
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't create policy document", description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" /> New Policy Document</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Policy Document</DialogTitle>
          <DialogDescription>Create a policy or procedure record. Upload and publish a version next, then run an attestation campaign against it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="policy-title">Title</Label>
            <Input id="policy-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Resident Rights Policy" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="policy-category">Category (optional)</Label>
            <Input id="policy-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Resident Care, HR, Safety" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="policy-description">Description (optional)</Label>
            <Textarea id="policy-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!title.trim() || isPending}>
            {isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE = 25;

export default function PolicyDocuments() {
  const { user } = useAuth();
  const [urlState, setUrlState] = useUrlState({ search: "", page: "1" });
  const page = Math.max(1, Number(urlState.page) || 1);
  const query = usePaginatedDomainList<Tables<"policy_documents">>("policy_documents", {
    organizationId: user?.organizationId ?? undefined,
    search: urlState.search,
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = query.data?.rows ?? [];
  const total = query.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Policies & Procedures</h1>
          <p className="text-muted-foreground">Versioned policy documents with ESIGN/UETA-compliant attestation campaigns.</p>
        </div>
        <NewPolicyDocumentDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5" /> Policy Documents ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={urlState.search}
            onChange={(e) => setUrlState({ search: e.target.value, page: "1" })}
            placeholder="Search policies by title, category, or description"
            className="max-w-sm"
            aria-label="Search policy documents"
          />
          {query.isError ? (
            <QueryError what="policy documents" error={query.error as Error} onRetry={() => query.refetch()} />
          ) : query.isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}
            </div>
          ) : !rows.length ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              {urlState.search
                ? "No policy documents match your search."
                : "No policy documents yet. Create one, upload a PDF version, and publish it to start an attestation campaign."}
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {rows.map((doc) => (
                  <Link key={doc.id} href={`/app/policy-documents/${doc.id}`}>
                    <div className="flex items-center justify-between gap-3 p-4 rounded-lg border hover:bg-accent/5 cursor-pointer">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm truncate">{doc.title}</p>
                          {doc.category && <Badge variant="outline" className="text-xs">{doc.category}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {doc.description || "No description"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={doc.current_version_id
                          ? "bg-success text-success-foreground hover:bg-success/80"
                          : "bg-muted text-muted-foreground"}>
                          {doc.current_version_id ? "Published" : "No published version"}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm">
                <span className="text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setUrlState({ page: String(page - 1) })}>Previous</Button>
                  <span className="px-1 text-muted-foreground">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setUrlState({ page: String(page + 1) })}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
