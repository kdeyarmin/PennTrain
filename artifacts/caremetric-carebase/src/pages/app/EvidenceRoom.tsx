import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { usePaginatedEvidenceCollections, useCreateEvidenceCollection } from "@/hooks/useEvidenceRoom";
import { useEvidenceCollectionListSummary, EMPTY_EVIDENCE_COLLECTION_LIST_SUMMARY } from "@/hooks/useDomainListSummaries";
import { useListFacilities } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { QueryError } from "@/components/QueryState";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { FolderLock, Plus, ChevronRight, Scale, FileCheck2, FilePen } from "lucide-react";

const EVIDENCE_STATUS_VARIANT: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-green-100 text-green-900",
  closed: "bg-blue-100 text-blue-900",
  withdrawn: "bg-red-100 text-red-900",
};

export function EvidenceStatusPill({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={`border-0 font-medium capitalize ${EVIDENCE_STATUS_VARIANT[value] ?? "bg-muted text-muted-foreground"}`}>
      {value}
    </Badge>
  );
}

const URL_DEFAULTS = { status: "all", facilityId: "all", page: "1" };
const PAGE_SIZE = 25;

export default function EvidenceRoom() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const { toast } = useToast();
  const [urlState, setUrlState] = useUrlState(URL_DEFAULTS);
  const [showCreate, setShowCreate] = useState(false);
  const [facilityId, setFacilityId] = useState("");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");

  const page = Math.max(1, Number(urlState.page) || 1);
  const facilityScope = urlState.facilityId === "all" ? undefined : urlState.facilityId;
  const statusScope = urlState.status === "all" ? undefined : urlState.status;

  const {
    data: collectionsPage,
    isLoading,
    isError,
    error,
    refetch,
  } = usePaginatedEvidenceCollections({
    organizationId: viewingOrgId ?? undefined,
    facilityId: facilityScope,
    status: statusScope,
    page,
    pageSize: PAGE_SIZE,
  });
  const summaryQuery = useEvidenceCollectionListSummary({ organizationId: viewingOrgId ?? undefined, facilityId: facilityScope });
  const summary = summaryQuery.data ?? EMPTY_EVIDENCE_COLLECTION_LIST_SUMMARY;
  const { data: facilities } = useListFacilities({ organizationId: viewingOrgId ?? undefined });
  const { mutate: createCollection, isPending: creating } = useCreateEvidenceCollection();

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");

  const rows = collectionsPage?.rows ?? [];
  const total = collectionsPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = urlState.status !== "all" || urlState.facilityId !== "all";

  const handleCreate = () => {
    createCollection(
      { facilityId, name: name.trim(), purpose: purpose.trim() },
      {
        onSuccess: () => {
          setShowCreate(false);
          setName("");
          setPurpose("");
          toast({ title: "Collection created", description: "Add binder exports, then publish it to share." });
        },
        onError: (err) =>
          toast({ title: "Could not create the collection", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FolderLock className="h-6 w-6" /> Documentation Room
          </h1>
          <p className="text-muted-foreground max-w-3xl">
            Share checksummed compliance binder exports with surveyors through revocable, expiring guest
            links. Every guest view and download is logged; artifacts are immutable snapshots, never live data.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => { setFacilityId(facilities?.[0]?.id ?? ""); setShowCreate(true); }}>
            <Plus className="h-4 w-4 mr-1" /> New collection
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <FilePen className="h-8 w-8 text-amber-600" />
            <div>
              <p className="text-2xl font-bold">{summaryQuery.isLoading ? "—" : summary.draft}</p>
              <p className="text-sm text-muted-foreground">Draft Collections</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <FileCheck2 className="h-8 w-8 text-green-600" />
            <div>
              <p className="text-2xl font-bold">{summaryQuery.isLoading ? "—" : summary.published}</p>
              <p className="text-sm text-muted-foreground">Published Rooms</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Scale className="h-8 w-8 text-red-600" />
            <div>
              <p className="text-2xl font-bold">{summaryQuery.isLoading ? "—" : summary.legalHolds}</p>
              <p className="text-sm text-muted-foreground">Legal Holds</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={urlState.status} onValueChange={(v) => setUrlState({ status: v, page: "1" })}>
              <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="withdrawn">Withdrawn</SelectItem>
              </SelectContent>
            </Select>
            <Select value={urlState.facilityId} onValueChange={(v) => setUrlState({ facilityId: v, page: "1" })}>
              <SelectTrigger className="w-48 h-9"><SelectValue placeholder="All Facilities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Facilities</SelectItem>
                {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {isError ? (
            <QueryError what="documentation collections" error={error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-10">
              {!hasFilters && total === 0
                ? "No documentation collections yet. Create one to assemble survey-ready exports."
                : "No collections match the current filters."}
            </p>
          ) : (
            <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="data-table min-w-[700px]">
                <thead>
                  <tr>
                    <th>Collection</th>
                    <th>Facility</th>
                    <th>Status</th>
                    <th>Published</th>
                    <th>Created</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="min-w-0">
                          <p className="font-medium truncate max-w-[280px]">{c.name}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[280px]">{c.purpose}</p>
                        </div>
                      </td>
                      <td className="text-sm">{c.facility?.name ?? "—"}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <EvidenceStatusPill value={c.status} />
                          {c.legal_hold && (
                            <Scale className="h-4 w-4 text-red-600" aria-label="Legal hold" />
                          )}
                        </div>
                      </td>
                      <td className="text-sm text-muted-foreground">
                        {c.published_at ? formatDateForDisplay(c.published_at) : "—"}
                      </td>
                      <td className="text-sm text-muted-foreground">{formatDateForDisplay(c.created_at)}</td>
                      <td>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/app/evidence/${c.id}`}>
                            Open <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setUrlState({ page: String(page - 1) })}>Previous</Button>
                <span className="px-1 text-muted-foreground">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setUrlState({ page: String(page + 1) })}>Next</Button>
              </div>
            </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New documentation collection</DialogTitle>
            <DialogDescription>
              A collection gathers immutable binder exports for one facility. Publish it when it is
              ready, then issue expiring guest links to surveyors.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="evidence-facility">Facility</Label>
              <Select value={facilityId} onValueChange={setFacilityId}>
                <SelectTrigger id="evidence-facility"><SelectValue placeholder="Select a facility" /></SelectTrigger>
                <SelectContent>
                  {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-name">Name</Label>
              <Input
                id="evidence-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="2026 DHS annual survey"
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-purpose">Purpose</Label>
              <Textarea
                id="evidence-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="What survey or request is this collection for?"
                maxLength={500}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !facilityId || name.trim().length < 3 || purpose.trim().length < 3}
            >
              {creating ? "Creating…" : "Create collection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
