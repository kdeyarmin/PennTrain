import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ArrowLeft, Building2, MapPin, Phone, Users, BookOpen, BarChart3, Clock, XCircle, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useListEmployees } from "@workspace/api-client-react";

interface Facility {
  id: number;
  name: string;
  facilityType: string;
  licenseNumber: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  administratorName: string | null;
  administratorEmail: string | null;
  capacity: number | null;
  currentCensus: number | null;
  licenseExpiration: string | null;
  isActive: boolean;
}

interface ComplianceSummary {
  facilityId: number;
  facilityName: string;
  facilityType: string;
  totalEmployees: number;
  medAdminStaff: number;
  compliantCount: number;
  dueSoonCount: number;
  expiredCount: number;
  missingCount: number;
  complianceScore: number;
  practicumsDue: number;
  annualHoursIncomplete: number;
}

interface DueDateRecord {
  id: number;
  type?: string;
  employeeId: number;
  employeeName: string | null;
  trainingTypeName: string | null;
  dueDate: string | null;
  status: string;
}

export default function FacilityDetail() {
  const [, params] = useRoute("/app/facilities/:id");
  const id = params?.id;

  const { data: facility, isLoading: facLoading } = useQuery<Facility>({
    queryKey: ["facility", id],
    queryFn: async () => {
      const res = await fetch(`/api/facilities/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Facility not found");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: summary, isLoading: sumLoading } = useQuery<ComplianceSummary>({
    queryKey: ["facility-compliance", id],
    queryFn: async () => {
      const res = await fetch(`/api/facilities/${id}/compliance-summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load compliance summary");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: employees, isLoading: empLoading } = useListEmployees({
    facilityId: id ? Number(id) : undefined,
  });

  const { data: upcomingDueDates } = useQuery<DueDateRecord[]>({
    queryKey: ["facility-upcoming", id],
    queryFn: async () => {
      const res = await fetch(`/api/facilities/${id}/upcoming-due-dates`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id,
  });

  const { data: recentlyExpired } = useQuery<DueDateRecord[]>({
    queryKey: ["facility-expired", id],
    queryFn: async () => {
      const res = await fetch(`/api/facilities/${id}/recently-expired`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id,
  });

  const isLoading = facLoading || sumLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!facility) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Facility not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/app/facilities">Back to Facilities</Link>
        </Button>
      </div>
    );
  }

  const score = summary?.complianceScore ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/facilities">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
      </div>

      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Building2 className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{facility.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline">{facility.facilityType}</Badge>
            <Badge variant={facility.isActive ? "default" : "secondary"}>{facility.isActive ? "Active" : "Inactive"}</Badge>
            {score !== null && (
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${score >= 80 ? "text-green-700 bg-green-50 border-green-200" : score >= 60 ? "text-yellow-700 bg-yellow-50 border-yellow-200" : "text-red-700 bg-red-50 border-red-200"}`}>
                {score}% Compliant
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">License Number</p>
            <p className="font-semibold text-sm">{facility.licenseNumber ?? "—"}</p>
            {facility.licenseExpiration && (
              <p className="text-xs text-muted-foreground mt-1">Expires: {facility.licenseExpiration}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Location</p>
            <div className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="font-semibold text-sm">{facility.city}, {facility.state}</p>
            </div>
            {facility.address && <p className="text-xs text-muted-foreground mt-1">{facility.address}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Capacity</p>
            <p className="font-semibold">{facility.currentCensus ?? "?"} / {facility.capacity ?? "?"} beds</p>
            {facility.phone && (
              <div className="flex items-center gap-1 mt-1">
                <Phone className="h-3 w-3 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{facility.phone}</p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Administrator</p>
            <p className="font-semibold text-sm">{facility.administratorName ?? "—"}</p>
            {facility.administratorEmail && <p className="text-xs text-muted-foreground truncate">{facility.administratorEmail}</p>}
          </CardContent>
        </Card>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4" /> Training Compliance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Staff tracked</span>
                  <span className="font-medium">{summary.totalEmployees} ({summary.medAdminStaff} med admin)</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-green-600">Compliant</span>
                  <span className="font-medium text-green-600">{summary.compliantCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-yellow-600">Due Soon</span>
                  <span className="font-medium text-yellow-600">{summary.dueSoonCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-red-600">Expired / Missing</span>
                  <span className="font-medium text-red-600">{summary.expiredCount + summary.missingCount}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4" /> Additional Requirements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Overall score</span>
                  <span className={`font-medium ${summary.complianceScore >= 80 ? "text-green-600" : summary.complianceScore >= 60 ? "text-yellow-600" : "text-red-600"}`}>
                    {summary.complianceScore}%
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Practicums pending</span>
                  <span className={`font-medium ${summary.practicumsDue > 0 ? "text-red-600" : "text-green-600"}`}>
                    {summary.practicumsDue}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Annual hours incomplete</span>
                  <span className={`font-medium ${summary.annualHoursIncomplete > 0 ? "text-yellow-600" : "text-green-600"}`}>
                    {summary.annualHoursIncomplete}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-amber-600" /> Upcoming Due Dates
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!upcomingDueDates || upcomingDueDates.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No upcoming due dates</p>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingDueDates.map(record => (
                  <Link key={record.id} href={`/app/employees/${record.employeeId}`}>
                    <div className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-accent/5 cursor-pointer">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{record.employeeName}</p>
                        <p className="text-xs text-muted-foreground truncate">{record.trainingTypeName}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-amber-600 font-medium">
                          {record.dueDate ? new Date(record.dueDate).toLocaleDateString() : "—"}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <XCircle className="h-4 w-4 text-red-600" /> Recently Expired
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!recentlyExpired || recentlyExpired.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No recently expired trainings</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentlyExpired.map(record => (
                  <Link key={record.id} href={`/app/employees/${record.employeeId}`}>
                    <div className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-accent/5 cursor-pointer">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{record.employeeName}</p>
                        <p className="text-xs text-muted-foreground truncate">{record.trainingTypeName}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-red-600 font-medium">
                          {record.dueDate ? `Expired ${new Date(record.dueDate).toLocaleDateString()}` : "Expired"}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Staff ({employees?.length ?? "..."})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {empLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !employees?.length ? (
            <p className="text-sm text-muted-foreground">No staff on record.</p>
          ) : (
            <div className="space-y-2">
              {employees.map(emp => (
                <Link key={emp.id} href={`/app/employees/${emp.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/5 cursor-pointer">
                    <div>
                      <p className="font-medium text-sm">{emp.firstName} {emp.lastName}</p>
                      <p className="text-xs text-muted-foreground">{emp.jobTitle}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {emp.administersMedications && <Badge variant="outline" className="text-xs">Med Admin</Badge>}
                      {emp.trainerStatus && <Badge variant="outline" className="text-xs">Trainer</Badge>}
                      <Badge variant={emp.status === "active" ? "default" : "secondary"} className="text-xs">{emp.status}</Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
