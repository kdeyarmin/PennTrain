import { useMemo, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  useGetPolicyDocument, useListPolicyDocumentVersions, useUploadPolicyDocumentVersion,
  usePublishPolicyDocumentVersion, usePolicyDocumentSignedUrl, type PolicyDocumentVersion,
} from "@/hooks/usePolicyDocuments";
import {
  useListPolicyAttestationCampaigns, useCreatePolicyAttestationCampaign,
  useListPolicyAttestations, useAssignPolicyAttestationToEmployee, type PolicyAttestation,
} from "@/hooks/usePolicyAttestations";
import { useListEmployees } from "@/hooks/useEmployees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Upload, FileText, Megaphone, Plus, Search, ChevronDown, ChevronRight } from "lucide-react";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function VersionStatusBadge({ status }: { status: string }) {
  return status === "published"
    ? <Badge className="bg-success text-success-foreground hover:bg-success/80">Published</Badge>
    : <Badge className="bg-muted text-muted-foreground">Draft</Badge>;
}

function AttestationStatusBadge({ attestation }: { attestation: PolicyAttestation }) {
  if (attestation.status === "attested") {
    return <Badge className="bg-success text-success-foreground hover:bg-success/80">Attested</Badge>;
  }
  if (attestation.due_date && attestation.due_date < new Date().toISOString().slice(0, 10)) {
    return <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive/80">Overdue</Badge>;
  }
  return <Badge className="bg-warning text-warning-foreground hover:bg-warning/80">Pending</Badge>;
}

// ---------------------------------------------------------------------------
// Versions tab
// ---------------------------------------------------------------------------

function VersionsTab({ documentId, currentVersionId }: { documentId: string; currentVersionId: string | null }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: versions, isLoading } = useListPolicyDocumentVersions(documentId);
  const uploadVersion = useUploadPolicyDocumentVersion();
  const publishVersion = usePublishPolicyDocumentVersion();
  const getSignedUrl = usePolicyDocumentSignedUrl();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nextVersionNumber = (versions?.[0]?.version_number ?? 0) + 1;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.organizationId) return;
    try {
      await uploadVersion.mutateAsync({
        file,
        policyDocumentId: documentId,
        organizationId: user.organizationId,
        versionNumber: nextVersionNumber,
        createdBy: user.id,
      });
      toast({ title: `Version ${nextVersionNumber} uploaded`, description: "Publish it to make it the version employees attest to." });
    } catch (err) {
      toast({ variant: "destructive", title: "Upload failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePublish = async (version: PolicyDocumentVersion) => {
    try {
      await publishVersion.mutateAsync({ id: version.id, policyDocumentId: documentId });
      toast({ title: `Version ${version.version_number} published`, description: "This is now the version new campaigns will target." });
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't publish", description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleView = async (version: PolicyDocumentVersion) => {
    try {
      const url = await getSignedUrl.mutateAsync(version);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't open document", description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Versions</CardTitle>
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploadVersion.isPending}>
            <Upload className="mr-2 h-4 w-4" /> {uploadVersion.isPending ? "Uploading..." : `Upload Version ${nextVersionNumber}`}
          </Button>
          <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={handleUpload} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
        ) : !versions?.length ? (
          <p className="text-sm text-muted-foreground text-center py-6">No versions uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">Version {v.version_number}</p>
                    <VersionStatusBadge status={v.status} />
                    {v.id === currentVersionId && <Badge variant="outline" className="text-xs">Current</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {v.file_name} · uploaded {fmtDate(v.created_at)}
                    {v.published_at ? ` · published ${fmtDate(v.published_at)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => handleView(v)}>View</Button>
                  {v.status === "draft" && (
                    <Button size="sm" onClick={() => handlePublish(v)} disabled={publishVersion.isPending}>Publish</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Assign-to-employees dialog -- same two-level fan-out convention as
// TrainingPlans.tsx's ApplyPlanDialog: this dialog fans out over EMPLOYEES,
// calling useAssignPolicyAttestationToEmployee's mutateAsync once per
// selected employee (that hook does the single-row insert; there's no
// per-employee "multiple items" level to fan out over here since a campaign
// is exactly one policy version).
// ---------------------------------------------------------------------------

function AssignCampaignDialog({
  campaignId, policyDocumentVersionId, dueDate, open, onClose,
}: {
  campaignId: string; policyDocumentVersionId: string; dueDate: string | null; open: boolean; onClose: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const { data: employees } = useListEmployees({ status: "active" });
  const { mutateAsync: assign } = useAssignPolicyAttestationToEmployee();

  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const sorted = useMemo(
    () => (employees ?? []).slice().sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [employees],
  );
  const filtered = sorted.filter((e) => !search || `${e.first_name} ${e.last_name}`.toLowerCase().includes(search.toLowerCase()));

  const toggle = (id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleClose = () => { setSelectedIds([]); setSearch(""); onClose(); };

  const handleAssign = async () => {
    if (!selectedIds.length) return;
    setAssigning(true);
    const targets = selectedIds.filter((id) => employeeById.has(id));
    const settled = await Promise.allSettled(
      targets.map((employeeId) => {
        const employee = employeeById.get(employeeId)!;
        return assign({
          campaignId,
          employeeId,
          organizationId: employee.organization_id,
          facilityId: employee.facility_id,
          policyDocumentVersionId,
          dueDate,
        });
      }),
    );
    setAssigning(false);

    let created = 0, alreadyAssigned = 0, failed = 0;
    settled.forEach((r) => {
      if (r.status === "fulfilled") { created++; return; }
      // Postgres unique_violation on (campaign_id, employee_id) -- this employee already has
      // an attestation for this campaign. Not a real failure, just a no-op worth tallying
      // separately so the toast doesn't read as "assignment broke" when it's just a re-run.
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      if (message.includes("policy_attestations_campaign_employee_uk") || message.includes("duplicate key")) {
        alreadyAssigned++;
      } else {
        failed++;
      }
    });

    toast({
      title: `Assigned to ${created} employee${created === 1 ? "" : "s"}`,
      description: [
        alreadyAssigned > 0 ? `${alreadyAssigned} already assigned` : null,
        failed > 0 ? `${failed} failed` : null,
      ].filter(Boolean).join(", ") || undefined,
      variant: failed > 0 ? "destructive" : undefined,
    });
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Assign Attestation to Employees</DialogTitle>
          <DialogDescription>Each selected employee gets a pending attestation for this campaign's policy version.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex-1 overflow-y-auto border rounded-md max-h-[300px]">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No active employees found.</p>
          ) : (
            <div className="divide-y">
              {filtered.map((emp) => (
                <label key={emp.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer">
                  <Checkbox checked={selectedIds.includes(emp.id)} onCheckedChange={() => toggle(emp.id)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{emp.first_name} {emp.last_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{emp.job_title ?? "—"}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleAssign} disabled={!selectedIds.length || assigning}>
            {assigning ? "Assigning..." : `Assign to ${selectedIds.length} Employee${selectedIds.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewCampaignDialog({ documentId, currentVersionId }: { documentId: string; currentVersionId: string | null }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { mutateAsync: createCampaign, isPending } = useCreatePolicyAttestationCampaign();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");

  const handleCreate = async () => {
    if (!name.trim() || !currentVersionId || !user?.organizationId) return;
    try {
      await createCampaign({
        organization_id: user.organizationId,
        policy_document_id: documentId,
        policy_document_version_id: currentVersionId,
        name: name.trim(),
        due_date: dueDate || null,
        created_by: user.id,
      });
      toast({ title: "Campaign created", description: "Now assign it to employees below." });
      setName(""); setDueDate(""); setOpen(false);
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't create campaign", description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={!currentVersionId}>
          <Plus className="mr-2 h-4 w-4" /> New Campaign
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Attestation Campaign</DialogTitle>
          <DialogDescription>Targets the currently published version. Assign it to employees once created.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-name">Campaign name</Label>
            <Input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 Annual Policy Review" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-due">Due date (optional)</Label>
            <Input id="campaign-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim() || isPending}>{isPending ? "Creating..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignRoster({ campaignId }: { campaignId: string }) {
  const { data: attestations, isLoading } = useListPolicyAttestations({ campaignId });
  const { data: employees } = useListEmployees();
  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);

  if (isLoading) return <div className="space-y-1 mt-2">{[...Array(2)].map((_, i) => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}</div>;
  if (!attestations?.length) return <p className="text-xs text-muted-foreground italic mt-2">Not assigned to anyone yet.</p>;

  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      {attestations.map((a) => {
        const employee = employeeById.get(a.employee_id);
        return (
          <div key={a.id} className="flex items-center justify-between text-xs py-1">
            <span>{employee ? `${employee.first_name} ${employee.last_name}` : `Employee #${a.employee_id.slice(0, 8)}`}</span>
            <AttestationStatusBadge attestation={a} />
          </div>
        );
      })}
    </div>
  );
}

function CampaignsTab({ documentId, currentVersionId }: { documentId: string; currentVersionId: string | null }) {
  const { data: campaigns, isLoading } = useListPolicyAttestationCampaigns({ policyDocumentId: documentId });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ id: string; versionId: string; dueDate: string | null } | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" /> Campaigns</CardTitle>
            <NewCampaignDialog documentId={documentId} currentVersionId={currentVersionId} />
          </div>
        </CardHeader>
        <CardContent>
          {!currentVersionId && (
            <p className="text-xs text-muted-foreground mb-3">Publish a version above before starting a campaign.</p>
          )}
          {isLoading ? (
            <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : !campaigns?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No campaigns yet.</p>
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => (
                <div key={c.id} className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <button
                      className="flex items-center gap-2 text-left min-w-0 flex-1"
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    >
                      {expandedId === c.id ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.due_date ? `Due ${fmtDate(c.due_date)}` : "No due date"}</p>
                      </div>
                    </button>
                    <Button
                      size="sm"
                      onClick={() => setAssignTarget({ id: c.id, versionId: c.policy_document_version_id, dueDate: c.due_date })}
                    >
                      Assign Employees
                    </Button>
                  </div>
                  {expandedId === c.id && <CampaignRoster campaignId={c.id} />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {assignTarget && (
        <AssignCampaignDialog
          campaignId={assignTarget.id}
          policyDocumentVersionId={assignTarget.versionId}
          dueDate={assignTarget.dueDate}
          open={!!assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </>
  );
}

export default function PolicyDocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: document, isLoading } = useGetPolicyDocument(id);

  if (isLoading || !document) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="h-40 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/policy-documents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-4 w-4" /> Back to Policies & Procedures
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight">{document.title}</h1>
          {document.category && <Badge variant="outline">{document.category}</Badge>}
        </div>
        {document.description && <p className="text-muted-foreground mt-1">{document.description}</p>}
      </div>

      <Tabs defaultValue="versions">
        <TabsList>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
        </TabsList>
        <TabsContent value="versions" className="mt-4">
          <VersionsTab documentId={document.id} currentVersionId={document.current_version_id} />
        </TabsContent>
        <TabsContent value="campaigns" className="mt-4">
          <CampaignsTab documentId={document.id} currentVersionId={document.current_version_id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
