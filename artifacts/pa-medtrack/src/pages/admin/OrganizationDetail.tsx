import { useState } from "react";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Building, Building2, ShieldCheck, FileArchive, Download, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetOrganization, useGetOrganizationStats, useUpdateOrganization } from "@/hooks/useOrganizations";
import { useListFacilities } from "@/hooks/useFacilities";
import { useGetPackage, useListPackages } from "@/hooks/usePackages";
import { useGenerateComplianceBinder } from "@/hooks/useComplianceBinder";
import { useToast } from "@/hooks/use-toast";
import { useViewingOrg } from "@/lib/viewingOrg";

export default function OrganizationDetail() {
  const [, params] = useRoute("/admin/organizations/:id");
  const id = params?.id;
  const { toast } = useToast();
  const { viewingOrgId, setViewingOrgId } = useViewingOrg();

  const { data: org, isLoading: orgLoading } = useGetOrganization(id);
  const { data: stats, isLoading: statsLoading } = useGetOrganizationStats(id);
  const { data: facilities, isLoading: facLoading } = useListFacilities({ organizationId: id });
  const { data: currentPackage } = useGetPackage(org?.package_id);
  const { data: packages } = useListPackages();
  const { mutate: updateOrganization, isPending: updatingPackage } = useUpdateOrganization();
  const { mutate: generateBinder, isPending: generatingBinder } = useGenerateComplianceBinder();
  const [binderResult, setBinderResult] = useState<{ url: string; expiresIn: number } | null>(null);

  const isLoading = orgLoading || statsLoading;

  const handleGenerateBinder = () => {
    if (!id) return;
    setBinderResult(null);
    generateBinder(
      { organizationId: id },
      {
        onSuccess: (data) => {
          setBinderResult({ url: data.url, expiresIn: data.expiresIn });
          toast({ title: "Compliance binder generated" });
        },
        onError: (e: Error) => toast({ title: "Failed to generate binder", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handlePackageChange = (value: string) => {
    if (!id) return;
    updateOrganization(
      { id, package_id: value === "none" ? null : value },
      {
        onSuccess: () => toast({ title: "Package updated" }),
        onError: (e: Error) => toast({ title: "Failed to update package", description: e.message, variant: "destructive" }),
      },
    );
  };

  const subscriptionColor = (status: string) => {
    if (status === "active") return "default";
    if (status === "trial") return "secondary";
    return "destructive";
  };

  if (!id) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Invalid organization id.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/admin/organizations">Back</Link>
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Organization not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/admin/organizations">Back</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/organizations">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Organizations
          </Link>
        </Button>
      </div>

      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Building className="h-7 w-7 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold">{org.name}</h1>
              <p className="text-muted-foreground text-sm">{org.slug}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant={subscriptionColor(org.subscription_status) as "default" | "secondary" | "destructive" | "outline"}>
                  {org.subscription_status}
                </Badge>
                {org.plan_name && <Badge variant="outline">{org.plan_name}</Badge>}
              </div>
            </div>
            {viewingOrgId === id ? (
              <Badge variant="default" className="shrink-0 gap-1.5 py-1.5 px-3">
                <ShieldCheck className="h-3.5 w-3.5" />
                Currently viewing this org
              </Badge>
            ) : (
              <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => setViewingOrgId(id)}>
                <ShieldCheck className="h-3.5 w-3.5" />
                View as this org
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Facilities</p>
            <p className="text-2xl font-bold">{stats?.facilityCount ?? "—"}</p>
            {org.max_facilities && <p className="text-xs text-muted-foreground">of {org.max_facilities} max</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Employees</p>
            <p className="text-2xl font-bold">{stats?.employeeCount ?? "—"}</p>
            {org.max_users && <p className="text-xs text-muted-foreground">of {org.max_users} max</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Contact</span>
              <span className="font-medium">{org.contact_name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{org.contact_email ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Phone</span>
              <span className="font-medium">{org.contact_phone ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Address</span>
              <span className="font-medium text-right">{org.address ? `${org.address}, ${org.city}, ${org.state} ${org.zip}` : "—"}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span className="font-medium">{org.plan_name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium capitalize">{org.subscription_status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Facilities</span>
              <span className="font-medium">{org.max_facilities ?? "Unlimited"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Users</span>
              <span className="font-medium">{org.max_users ?? "Unlimited"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Package</span>
              <span className="font-medium">{currentPackage?.name ?? "None assigned"}</span>
            </div>
            <div className="pt-2 space-y-1.5">
              <span className="text-xs text-muted-foreground">Change package</span>
              <Select value={org.package_id ?? "none"} onValueChange={handlePackageChange} disabled={updatingPackage}>
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" /> Facilities
          </CardTitle>
        </CardHeader>
        <CardContent>
          {facLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : !facilities?.length ? (
            <p className="text-sm text-muted-foreground">No facilities.</p>
          ) : (
            <div className="space-y-2">
              {facilities.map(fac => (
                <div key={fac.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{fac.name}</p>
                    <p className="text-xs text-muted-foreground">{fac.city}, {fac.state} — {fac.license_number ?? "No license"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{fac.facility_type}</Badge>
                    <Badge variant={fac.is_active ? "default" : "secondary"} className="text-xs">{fac.is_active ? "Active" : "Inactive"}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" /> Compliance Binder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Generate a compliance summary PDF for {org.name} -- facility roster, staff training compliance,
            overdue practicums, certificates issued, and open alerts.
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerateBinder} disabled={generatingBinder}>
              {generatingBinder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}
              {generatingBinder ? "Generating..." : "Generate Binder PDF"}
            </Button>
            {binderResult && (
              <Button variant="outline" asChild>
                <a href={binderResult.url} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </a>
              </Button>
            )}
          </div>
          {binderResult && (
            <p className="text-xs text-muted-foreground">
              This link expires in {Math.round(binderResult.expiresIn / 60)} minutes.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
