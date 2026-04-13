import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building, Building2, LogIn } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Organization {
  id: number;
  name: string;
  slug: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  subscriptionStatus: string;
  planName: string | null;
  maxFacilities: number | null;
  maxUsers: number | null;
  isActive: boolean;
}

interface OrgStats {
  organizationId: number;
  totalFacilities: number;
  totalEmployees: number;
  totalMedAdminStaff: number;
  compliantCount: number;
  dueSoonCount: number;
  expiredCount: number;
  compliancePercentage: number;
  openAlertsCount: number;
}

interface Facility {
  id: number;
  name: string;
  facilityType: string;
  licenseNumber: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
}

export default function OrganizationDetail() {
  const [, params] = useRoute("/admin/organizations/:id");
  const id = params?.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setImpersonating] = useState(false);

  const { data: org, isLoading: orgLoading } = useQuery<Organization>({
    queryKey: ["organization", id],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Organization not found");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<OrgStats>({
    queryKey: ["organization-stats", id],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${id}/stats`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: facilities, isLoading: facLoading } = useQuery<Facility[]>({
    queryKey: ["facilities-for-org", id],
    queryFn: async () => {
      const res = await fetch(`/api/facilities?organizationId=${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load facilities");
      return res.json();
    },
    enabled: !!id,
  });

  const impersonateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/impersonate-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organizationId: Number(id) }),
      });
      if (!res.ok) throw new Error("Failed to start impersonation");
      return res.json();
    },
    onSuccess: (data) => {
      setImpersonating(true);
      queryClient.invalidateQueries();
      toast({ title: `Viewing as: ${data.organization?.name ?? org?.name}`, description: "You are now viewing this organization's data." });
      navigate("/");
    },
    onError: () => {
      toast({ title: "Failed to switch organization view", variant: "destructive" });
    },
  });

  const isLoading = orgLoading || statsLoading;

  const subscriptionColor = (status: string) => {
    if (status === "active") return "default";
    if (status === "trial") return "secondary";
    return "destructive";
  };

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
                <Badge variant={subscriptionColor(org.subscriptionStatus) as "default" | "secondary" | "destructive" | "outline"}>
                  {org.subscriptionStatus}
                </Badge>
                {org.planName && <Badge variant="outline">{org.planName}</Badge>}
                {!org.isActive && <Badge variant="destructive">Inactive</Badge>}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => impersonateMutation.mutate()}
              disabled={impersonateMutation.isPending}
              className="shrink-0"
            >
              <LogIn className="mr-2 h-4 w-4" />
              {impersonateMutation.isPending ? "Switching..." : "View as this Organization"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Facilities</p>
            <p className="text-2xl font-bold">{stats?.totalFacilities ?? "—"}</p>
            {org.maxFacilities && <p className="text-xs text-muted-foreground">of {org.maxFacilities} max</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Active Employees</p>
            <p className="text-2xl font-bold">{stats?.totalEmployees ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{stats?.totalMedAdminStaff ?? 0} med admin</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Open Alerts</p>
            <p className={`text-2xl font-bold ${(stats?.openAlertsCount ?? 0) > 0 ? "text-red-600" : "text-green-600"}`}>
              {stats?.openAlertsCount ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Compliance Score</p>
            <p className={`text-2xl font-bold ${(stats?.compliancePercentage ?? 0) >= 80 ? "text-green-600" : (stats?.compliancePercentage ?? 0) >= 60 ? "text-yellow-600" : "text-red-600"}`}>
              {stats?.compliancePercentage ?? "—"}{stats ? "%" : ""}
            </p>
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
              <span className="font-medium">{org.contactName ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{org.contactEmail ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Phone</span>
              <span className="font-medium">{org.contactPhone ?? "—"}</span>
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
              <span className="font-medium">{org.planName ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium capitalize">{org.subscriptionStatus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Facilities</span>
              <span className="font-medium">{org.maxFacilities ?? "Unlimited"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Users</span>
              <span className="font-medium">{org.maxUsers ?? "Unlimited"}</span>
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
                    <p className="text-xs text-muted-foreground">{fac.city}, {fac.state} — {fac.licenseNumber ?? "No license"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{fac.facilityType}</Badge>
                    <Badge variant={fac.isActive ? "default" : "secondary"} className="text-xs">{fac.isActive ? "Active" : "Inactive"}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
