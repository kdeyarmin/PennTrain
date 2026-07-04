import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities, type Facility } from "@/hooks/useFacilities";
import { useListTrainingClasses } from "@/hooks/useTrainingClasses";
import { useListPracticums, type Practicum } from "@/hooks/usePracticums";
import type { Employee } from "@/hooks/useEmployees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GraduationCap,
  Users,
  CheckCircle,
  Clock,
  Building2,
  Plus,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { Link } from "wouter";

interface FacilityRetrainingStatus {
  facilityId: string;
  facilityName: string;
  totalMedAdminStaff: number;
  compliantCount: number;
  dueSoonCount: number;
  expiredCount: number;
  missingCount: number;
  overallStatus: "compliant" | "due_soon" | "expired" | "critical";
}

// There is no server-side facility retraining aggregate (the old Express endpoint
// is gone); derive the same shape from facilities + employees + practicums.
function buildFacilityRetrainingStatus(
  facilities: Facility[],
  employees: Employee[],
  practicums: Practicum[]
): FacilityRetrainingStatus[] {
  return facilities.map((facility) => {
    const staffCount = employees.filter(
      (e) => e.facility_id === facility.id && e.administers_medications
    ).length;
    const facilityPracticums = practicums.filter((p) => p.facility_id === facility.id);

    const compliantCount = facilityPracticums.filter((p) => p.status === "compliant").length;
    const dueSoonCount = facilityPracticums.filter((p) => p.status === "due_soon").length;
    const expiredCount = facilityPracticums.filter((p) => p.status === "expired").length;
    const missingCount = facilityPracticums.filter((p) => p.status === "missing").length;

    let overallStatus: FacilityRetrainingStatus["overallStatus"] = "compliant";
    if (staffCount > 0 && expiredCount > 0 && compliantCount === 0) overallStatus = "critical";
    else if (expiredCount > 0) overallStatus = "expired";
    else if (dueSoonCount > 0 || missingCount > 0) overallStatus = "due_soon";

    return {
      facilityId: facility.id,
      facilityName: facility.name,
      totalMedAdminStaff: staffCount,
      compliantCount,
      dueSoonCount,
      expiredCount,
      missingCount,
      overallStatus,
    };
  });
}

export default function TrainerDashboard() {
  const { user } = useAuth();

  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees();
  const { data: classes } = useListTrainingClasses();
  const { data: practicums, isLoading: practicumsLoading } = useListPracticums({
    year: new Date().getFullYear(),
  });

  const allEmployees = employees ?? [];
  const totalMedAdmin = allEmployees.filter((e) => e.administers_medications).length;
  const totalFacilities = facilities?.length ?? 0;
  const allClasses = classes ?? [];
  const totalClasses = allClasses.length;
  const draftClasses = allClasses.filter((c) => c.status === "draft").length;
  const compliant = practicums?.filter((p) => p.status === "compliant").length ?? 0;
  const pending = practicums?.filter((p) => p.status !== "compliant").length ?? 0;

  const retraining = useMemo(
    () => buildFacilityRetrainingStatus(facilities ?? [], allEmployees, practicums ?? []),
    [facilities, allEmployees, practicums]
  );
  const facilitiesNeedingAttention = retraining.filter(
    (f) => f.overallStatus === "critical" || f.overallStatus === "expired" || f.overallStatus === "due_soon"
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Trainer Dashboard
          </h1>
          <p className="text-muted-foreground">
            Welcome, {user?.firstName}. Manage training sessions and track
            certifications.
          </p>
        </div>
        <Link href="/trainer/classes">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Class
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <GraduationCap className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{totalClasses}</p>
                <p className="text-sm text-muted-foreground">Total Classes</p>
              </div>
            </div>
            {draftClasses > 0 && (
              <p className="text-xs text-yellow-600 mt-2">
                {draftClasses} draft{draftClasses > 1 ? "s" : ""} pending
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Building2 className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-2xl font-bold">{totalFacilities}</p>
                <p className="text-sm text-muted-foreground">Facilities</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-emerald-600" />
              <div>
                <p className="text-2xl font-bold">{totalMedAdmin}</p>
                <p className="text-sm text-muted-foreground">Med Admin Staff</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              {pending > 0 ? (
                <Clock className="h-8 w-8 text-yellow-600" />
              ) : (
                <CheckCircle className="h-8 w-8 text-green-600" />
              )}
              <div>
                <p className="text-2xl font-bold">
                  {practicumsLoading ? "—" : compliant}
                </p>
                <p className="text-sm text-muted-foreground">
                  Practicums OK
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5" />
                Recent Classes
              </CardTitle>
              <Link href="/trainer/classes">
                <Button variant="ghost" size="sm">
                  View All
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {allClasses.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-muted-foreground text-sm mb-3">
                  No classes yet.
                </p>
                <Link href="/trainer/classes">
                  <Button variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Create First Class
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {allClasses.slice(0, 5).map((c) => (
                  <Link
                    key={c.id}
                    href={`/trainer/classes/${c.id}`}
                    className="flex items-center justify-between py-2 border-b last:border-0 hover:bg-muted/50 rounded px-2 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {c.class_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(c.class_date).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge
                      variant={
                        c.status === "completed"
                          ? "default"
                          : c.status === "cancelled"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {c.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Facilities Needing Attention
              </CardTitle>
              <Link href="/trainer/retraining">
                <Button variant="ghost" size="sm">
                  Monitor
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {facilitiesNeedingAttention.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircle className="h-10 w-10 text-green-600/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  All facilities are compliant.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {facilitiesNeedingAttention.slice(0, 5).map((f) => {
                  const badgeVariant =
                    f.overallStatus === "critical" || f.overallStatus === "expired"
                      ? "destructive"
                      : "secondary";
                  return (
                    <div
                      key={f.facilityId}
                      className="flex items-center justify-between py-2 border-b last:border-0 text-sm"
                    >
                      <div>
                        <p className="font-medium">{f.facilityName}</p>
                        <p className="text-xs text-muted-foreground">
                          {f.expiredCount} expired &middot; {f.dueSoonCount} due
                          soon
                        </p>
                      </div>
                      <Badge variant={badgeVariant}>
                        {f.overallStatus.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
