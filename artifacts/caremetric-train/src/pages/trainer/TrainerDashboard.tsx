import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListTrainingClasses, useClassAttendeeCounts } from "@/hooks/useTrainingClasses";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListMyFacilityAssignments } from "@/hooks/useFacilityAssignments";
import {
  buildFacilityRetrainingStatus,
  ORG_WIDE_VISIBILITY_ROLES,
} from "@/lib/facilityRetrainingStatus";
import { todayIso } from "@/lib/scheduleDates";
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
  Monitor,
} from "lucide-react";
import { Link } from "wouter";

export default function TrainerDashboard() {
  const { user } = useAuth();

  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees();
  const { data: classes } = useListTrainingClasses();
  const { data: attendeeCounts } = useClassAttendeeCounts();
  const { data: practicums, isLoading: practicumsLoading } = useListPracticums({
    year: new Date().getFullYear(),
  });

  const hasOrgWideVisibility = !user?.role || ORG_WIDE_VISIBILITY_ROLES.has(user.role);
  const { data: myAssignments } = useListMyFacilityAssignments(user?.id, !hasOrgWideVisibility);
  const assignedFacilityIds = useMemo(
    () => new Set((myAssignments ?? []).map((a) => a.facility_id)),
    [myAssignments]
  );

  const allEmployees = employees ?? [];
  const totalMedAdmin = allEmployees.filter((e) => e.administers_medications).length;
  const totalFacilities = facilities?.length ?? 0;
  const allClasses = classes ?? [];
  const totalClasses = allClasses.length;
  const draftClasses = allClasses.filter((c) => c.status === "draft").length;
  // "Recent Classes" below is sorted by date descending (a future-dated class can outrank
  // today's), and reaching the kiosk from there is dashboard -> class detail -> "Open Kiosk Mode".
  // Surface today's still-open class(es) directly here with a one-click kiosk launch. Only draft
  // classes qualify -- a completed/cancelled class dated today has nothing left to check in.
  const todaysClasses = allClasses.filter((c) => c.class_date === todayIso() && c.status === "draft");
  const compliant = practicums?.filter((p) => p.status === "compliant").length ?? 0;
  const pending = practicums?.filter((p) => p.status !== "compliant").length ?? 0;

  const retraining = useMemo(
    () =>
      buildFacilityRetrainingStatus(facilities ?? [], allEmployees, practicums ?? [], {
        role: user?.role ?? null,
        assignedFacilityIds,
      }),
    [facilities, allEmployees, practicums, user?.role, assignedFacilityIds]
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

      {todaysClasses.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <Monitor className="h-8 w-8 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {todaysClasses.length === 1 ? "Today's Class" : `${todaysClasses.length} Classes Today`}
                  </p>
                  <p className="text-lg font-semibold">
                    {todaysClasses.length === 1 ? todaysClasses[0].class_name : "Ready to check people in?"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {todaysClasses.map((c) => (
                  <Link key={c.id} href={`/trainer/classes/${c.id}/kiosk`}>
                    <Button size="sm">
                      <Monitor className="h-4 w-4 mr-2" />
                      {todaysClasses.length === 1 ? "Open Kiosk" : `Open Kiosk — ${c.class_name}`}
                    </Button>
                  </Link>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                        {new Date(c.class_date).toLocaleDateString()} &middot;{" "}
                        {attendeeCounts?.[c.id] ?? 0} attendee
                        {(attendeeCounts?.[c.id] ?? 0) === 1 ? "" : "s"}
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
