import { useState } from "react";
import { useListOrganizations, useCreateOrganization } from "@/hooks/useOrganizations";
import { useListPackages } from "@/hooks/usePackages";
import { useUrlState } from "@/hooks/useUrlState";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { Building2, Search, ChevronRight, Plus, Download } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { csvEscape } from "@/lib/csv";
import { humanize } from "@/lib/utils";

// Every subscription_status the organizations table's check constraint allows (see
// 20260706141329_block_canceled_orgs_and_lock_limit_checks.sql) -- kept in one place so the
// filter below and the CSV export/status badge elsewhere in this file never drift from the real
// set of values a row can actually have.
const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "suspended", "canceled"] as const;

// Filter state only -- the "Add Organization" dialog's form fields intentionally stay in local
// useState below, since a half-filled create form isn't something worth restoring via Back/Forward
// or a shared link the way an active filter is.
const ORGANIZATIONS_URL_DEFAULTS = {
  search: "",
  status: "all",
};

// csvEscape also neutralizes formula injection (leading = + - @) for user-entered text.
function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface OrgFormData {
  name: string;
  slug: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  packageId: string;
}

const EMPTY_ORG: OrgFormData = {
  name: "", slug: "", contactName: "", contactEmail: "", contactPhone: "",
  address: "", city: "", state: "", zip: "", packageId: "",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export default function Organizations() {
  const [urlState, setUrlState] = useUrlState(ORGANIZATIONS_URL_DEFAULTS);
  const [showForm, setShowForm] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);
  const [form, setForm] = useState<OrgFormData>(EMPTY_ORG);

  const { toast } = useToast();
  const { data: orgs, isLoading } = useListOrganizations();
  const { data: packages } = useListPackages();
  const { mutate: createOrganization, isPending: creating } = useCreateOrganization();

  const filtered = orgs?.filter(o =>
    (!urlState.search || o.name.toLowerCase().includes(urlState.search.toLowerCase())) &&
    (urlState.status === "all" || o.subscription_status === urlState.status)
  ) ?? [];

  const handleExportCsv = () => {
    const headers = ["Name", "Slug", "Status", "Plan", "Contact Email", "Max Facilities", "Max Users", "Trial Ends"];
    const rows = filtered.map(o => [
      o.name,
      o.slug,
      o.subscription_status ?? "",
      o.plan_name ?? "",
      o.contact_email ?? "",
      o.max_facilities?.toString() ?? "",
      o.max_users?.toString() ?? "",
      o.trial_ends_at ? new Date(o.trial_ends_at).toLocaleDateString() : "",
    ]);
    downloadCsv(toCsv(headers, rows), `organizations-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const openCreate = () => {
    setForm(EMPTY_ORG);
    setSlugEdited(false);
    setShowForm(true);
  };

  const field = (k: keyof OrgFormData, v: string) =>
    setForm(f => ({ ...f, [k]: v }));

  const handleNameChange = (value: string) => {
    setForm(f => ({
      ...f,
      name: value,
      slug: slugEdited ? f.slug : slugify(value),
    }));
  };

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast({ title: "Organization name is required", variant: "destructive" });
      return;
    }
    if (!form.slug.trim()) {
      toast({ title: "Slug is required", variant: "destructive" });
      return;
    }
    createOrganization(
      {
        name: form.name.trim(),
        slug: form.slug.trim(),
        contact_name: form.contactName || null,
        contact_email: form.contactEmail || null,
        contact_phone: form.contactPhone || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        zip: form.zip || null,
        package_id: form.packageId || null,
        subscription_status: "trial",
      },
      {
        onSuccess: () => {
          toast({ title: "Organization created" });
          setShowForm(false);
          setForm(EMPTY_ORG);
        },
        onError: (e: Error) => toast({ title: "Failed to create organization", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Organizations</h1>
          <p className="text-muted-foreground">Manage all tenant organizations.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportCsv} disabled={!filtered.length}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Add Organization
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search organizations..."
                value={urlState.search}
                onChange={e => setUrlState({ search: e.target.value })}
                className="pl-9"
              />
            </div>
            <Select value={urlState.status} onValueChange={v => setUrlState({ status: v })}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {SUBSCRIPTION_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(org => (
                <Link key={org.id} href={`/admin/organizations/${org.id}`}>
                  <div className="flex items-center justify-between gap-3 p-4 rounded-lg hover:bg-muted/50 border transition-colors cursor-pointer">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{org.name}</p>
                        <p className="text-sm text-muted-foreground truncate">{org.contact_email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={org.subscription_status ?? "active"} type="subscription" />
                      <span className="text-sm text-muted-foreground">{org.plan_name ?? "Standard"}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <Building2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-muted-foreground">No organizations found</p>
                  <p className="text-sm text-muted-foreground/60 mt-1">Try adjusting your search or filters.</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={o => { if (!o) setShowForm(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Organization</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Name *</Label>
              <Input value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="Acme Care Group" className="h-9" />
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Slug *</Label>
              <Input
                value={form.slug}
                onChange={e => { setSlugEdited(true); field("slug", e.target.value); }}
                placeholder="acme-care-group"
                className="h-9"
              />
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Package</Label>
              <Select value={form.packageId || "none"} onValueChange={v => field("packageId", v === "none" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="No package" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No package</SelectItem>
                  {packages?.map(pkg => (
                    <SelectItem key={pkg.id} value={pkg.id}>
                      {pkg.name}{!pkg.is_active ? " (inactive)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Contact Name</Label>
              <Input value={form.contactName} onChange={e => field("contactName", e.target.value)} placeholder="Jane Smith" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Contact Email</Label>
              <Input type="email" value={form.contactEmail} onChange={e => field("contactEmail", e.target.value)} placeholder="jane@example.com" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Contact Phone</Label>
              <Input value={form.contactPhone} onChange={e => field("contactPhone", e.target.value)} placeholder="(215) 555-0100" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Address</Label>
              <Input value={form.address} onChange={e => field("address", e.target.value)} placeholder="123 Main St" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">City</Label>
              <Input value={form.city} onChange={e => field("city", e.target.value)} placeholder="Philadelphia" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">State</Label>
              <Input value={form.state} onChange={e => field("state", e.target.value)} placeholder="PA" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Zip</Label>
              <Input value={form.zip} onChange={e => field("zip", e.target.value)} placeholder="19107" className="h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating} className="shadow-sm">
              {creating ? "Creating..." : "Create Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
