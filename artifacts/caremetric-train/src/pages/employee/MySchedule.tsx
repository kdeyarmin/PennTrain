import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListShiftAssignments } from "@/hooks/useShiftAssignments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { CalendarDays, Clock, MapPin } from "lucide-react";
import { formatDateLabel, formatTimeLabel, todayIso } from "@/lib/scheduleDates";

export default function MySchedule() {
  const { user } = useAuth();
  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  // Gate on a resolved employee id -- see useListShiftAssignments' own comment on why `enabled`,
  // not just the filter, is required to avoid an unscoped fetch-then-refetch on every page load.
  const { data: shifts, isLoading: shiftsLoading } = useListShiftAssignments(
    { employeeId: employee?.id, fromDate: todayIso() },
    { enabled: !!employee?.id },
  );

  const isLoading = employeeLoading || shiftsLoading;
  const upcoming = shifts ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Schedule</h1>
        <p className="text-muted-foreground">Your upcoming published shifts.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Upcoming Shifts ({upcoming.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}
            </div>
          ) : upcoming.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              No upcoming shifts published yet. Check back once your manager publishes the schedule.
            </p>
          ) : (
            <div className="space-y-2">
              {upcoming.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div>
                    <div className="font-medium">{formatDateLabel(s.shift_date, { weekday: "long", month: "short", day: "numeric" })}</div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {s.shift_definitions?.name ? `${s.shift_definitions.name} · ` : ""}
                        {formatTimeLabel(s.start_time)}–{formatTimeLabel(s.end_time)}
                      </span>
                      {s.facility_units?.name && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {s.facility_units.name}
                        </span>
                      )}
                    </div>
                    {s.notes && <p className="text-sm text-muted-foreground mt-1">{s.notes}</p>}
                  </div>
                  <StatusBadge status={s.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
