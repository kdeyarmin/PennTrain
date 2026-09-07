import { formatDateForDisplay } from "@/lib/dateUtils";
import { useAuth } from "@/lib/auth";
import { useTrainerDashboardSummary } from "@/hooks/useDashboardSummary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
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

  // One RLS-scoped server round trip replaces the previous four unbounded table
  // downloads + client aggregation (see get_trainer_dashboard_summary).
  const {
    data: summary,
    isLoading,
    isError,
    error,
    refetch,
  } = useTrainerDashboardSummary();

  const totalClasses = summary?.classes.totalCount ?? 0;
  const draftClasses = summary?.classes.draftCount ?? 0;
  const totalFacilities = summary?.staff.totalFacilities ?? 0;
  const totalMedAdmin = summary?.staff.totalMedAdminStaff ?? 0;
  const compliant = summary?.staff.practicumsCompliant ?? 0;
  const pending = summary?.staff.practicumsPending ?? 0;
  const todaysClasses = summary?.classes.todays ?? [];
  const recentClasses = summary?.classes.recent ?? [];
  const facilitiesNeedingAttention = summary?.facilitiesNeedingAttention ?? [];

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
        <div className="flex flex-wrap gap-2">
          {/* `todays` is the sessions that are open for enrollment or in progress today -- the ones
              a kiosk is for. It used to be today's DRAFTS, so a class the trainer had opened for
              enrollment vanished from this button on the morning it ran (BACKLOG.md J74, Train). */}
          {todaysClasses.length > 0 && (
            <Link href={`/trainer/classes/${todaysClasses[0].id}/kiosk`}>
              <Button>
                <Monitor className="h-4 w-4 mr-2" />
                {todaysClasses.length === 1 ? "Start today's kiosk" : "Open today's kiosk"}
              </Button>
            </Link>
          )}
          <Link href="/trainer/gaps">
            <Button variant="outline">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Training gaps
            </Button>
          </Link>
          <Link href="/trainer/classes">
            <Button variant={todaysClasses.length > 0 ? "outline" : "default"}>
              <Plus className="h-4 w-4 mr-2" />
              New Class
            </Button>
          </Link>
        </div>
      </div>

      {isError && (
        <QueryError
          what="the training dashboard"
          error={error}
          onRetry={() => void refetch()}
        />
      )}
      {!isError && (
      <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <GraduationCap className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{isLoading ? "—" : totalClasses}</p>
                <p className="text-sm text-muted-foreground">Total Classes</p>
              </div>
            </div>
            {!isLoading && draftClasses > 0 && (
              <p className="text-xs text-yellow-600 mt-2">
                {draftClasses} not yet open for enrollment
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Building2 className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-2xl font-bold">{isLoading ? "—" : totalFacilities}</p>
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
                <p className="text-2xl font-bold">{isLoading ? "—" : totalMedAdmin}</p>
                <p className="text-sm text-muted-foreground">Med Admin Staff</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              {!isLoading && pending > 0 ? (
                <Clock className="h-8 w-8 text-yellow-600" />
              ) : (
                <CheckCircle className="h-8 w-8 text-green-600" />
              )}
              <div>
                <p className="text-2xl font-bold">
                  {isLoading ? "—" : compliant}
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
                    {todaysClasses.length === 1 ? todaysClasses[0].className : "Ready to check people in?"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {todaysClasses.map((c) => (
                  <Link key={c.id} href={`/trainer/classes/${c.id}/kiosk`}>
                    <Button size="sm">
                      <Monitor className="h-4 w-4 mr-2" />
                      {todaysClasses.length === 1 ? "Open Kiosk" : `Open Kiosk — ${c.className}`}
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
            {isLoading ? (
              <div className="text-center py-6">
                <p className="text-muted-foreground text-sm">Loading…</p>
              </div>
            ) : recentClasses.length === 0 ? (
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
                {recentClasses.map((c) => (
                  <Link
                    key={c.id}
                    href={`/trainer/classes/${c.id}`}
                    className="flex items-center justify-between py-2 border-b last:border-0 hover:bg-muted/50 rounded px-2 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {c.className}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateForDisplay(c.classDate)} &middot;{" "}
                        {c.attendeeCount} attendee
                        {c.attendeeCount === 1 ? "" : "s"}
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
            {isLoading ? (
              <div className="text-center py-6">
                <p className="text-muted-foreground text-sm">Loading…</p>
              </div>
            ) : facilitiesNeedingAttention.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircle className="h-10 w-10 text-green-600/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  All facilities are compliant.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {facilitiesNeedingAttention.map((f) => {
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
      </>
      )}
    </div>
  );
}
