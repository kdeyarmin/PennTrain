import { Link } from "wouter";
import {
  AlertTriangle, ClipboardCheck, Grid3x3, GraduationCap, ChevronRight, ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfacePurpose } from "@/components/SurfacePurpose";
import { useAuth } from "@/lib/auth";
import { useTrainerDashboardSummary } from "@/hooks/useDashboardSummary";
import { QueryError, QueryLoading } from "@/components/QueryState";

/**
 * Single trainer "who's behind" hub — matrix, retraining, and pending approvals in one place
 * so trainers stop hopping three nav items for the same question.
 */
export default function TrainerGaps() {
  const { user } = useAuth();
  const { data: summary, isLoading, isError, error, refetch } = useTrainerDashboardSummary();

  const pending = summary?.staff.practicumsPending ?? 0;
  const facilitiesNeedingAttention = summary?.facilitiesNeedingAttention ?? [];

  const hubs = [
    {
      href: "/app/training-matrix",
      title: "Training matrix",
      description: "Per-employee compliance across required trainings — overdue and due soon.",
      icon: Grid3x3,
      stat: null as string | null,
    },
    {
      href: "/trainer/retraining",
      title: "Retraining monitor",
      description: "Med-admin and recertification gaps ready for cohort enrollment.",
      icon: ShieldAlert,
      stat: pending > 0 ? `${pending} practicum pending` : "Practicums current",
    },
    {
      href: "/app/pending-approvals",
      title: "Pending approvals",
      description: "External certificates and uploads waiting for trainer/manager sign-off.",
      icon: ClipboardCheck,
      stat: null,
    },
    {
      href: "/app/course-assignments",
      title: "Training assignments",
      description: "Assign or reassign courses to close gaps from the matrix.",
      icon: GraduationCap,
      stat: null,
    },
  ];

  if (isLoading) return <QueryLoading what="training gaps" />;
  if (isError) {
    return <QueryError what="training gaps" error={error} onRetry={() => void refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Trainer hub</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Training gaps</h1>
          <p className="text-muted-foreground mt-1">
            One place for who still needs training, recertification, or approval — {user?.firstName}.
          </p>
        </div>
        <Button asChild>
          <Link href="/trainer/classes">
            <GraduationCap className="mr-2 h-4 w-4" /> Manage classes
          </Link>
        </Button>
      </div>

      <SurfacePurpose purpose="Gaps hub = who is behind. Classes and kiosk stay on the trainer dashboard for live sessions." />

      {facilitiesNeedingAttention.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              Facilities needing attention
            </CardTitle>
            <CardDescription>
              From the trainer summary — open the matrix or retraining monitor to act.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {facilitiesNeedingAttention.slice(0, 8).map((facility) => (
              <div
                key={facility.facilityId}
                className="flex items-center justify-between rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{facility.facilityName}</p>
                  <p className="text-xs text-muted-foreground">
                    {facility.expiredCount} expired · {facility.dueSoonCount} due soon
                  </p>
                </div>
                <Badge
                  variant={
                    facility.overallStatus === "critical" || facility.overallStatus === "expired"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {facility.overallStatus.replace(/_/g, " ")}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {hubs.map((hub) => {
          const Icon = hub.icon;
          return (
            <Link key={hub.href} href={hub.href} className="group block h-full">
              <Card className="h-full transition-all hover:border-primary/40 hover:shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <CardTitle className="text-base">{hub.title}</CardTitle>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <CardDescription>{hub.description}</CardDescription>
                  {hub.stat && (
                    <Badge variant="outline" className="text-[11px]">{hub.stat}</Badge>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
