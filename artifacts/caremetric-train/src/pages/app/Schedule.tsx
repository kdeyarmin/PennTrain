import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListSchedules, useCreateSchedule, type Schedule } from "@/hooks/useSchedules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { CalendarDays, Plus, Settings2, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { addDaysIso, formatDateLabel, startOfWeekIso, todayIso } from "@/lib/scheduleDates";

export default function Schedule() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: facilities } = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const [facilityId, setFacilityId] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);

  const activeFacilityId = facilityId || facilities?.[0]?.id || "";

  const { data: schedules, isLoading } = useListSchedules({ facilityId: activeFacilityId || undefined });
  const createSchedule = useCreateSchedule();

  const thisMonday = startOfWeekIso(todayIso());
  const [periodStart, setPeriodStart] = useState(thisMonday);
  const [periodLength, setPeriodLength] = useState<"7" | "14">("7");
  const [title, setTitle] = useState("");

  const periodEnd = useMemo(() => addDaysIso(periodStart, Number(periodLength) - 1), [periodStart, periodLength]);

  function resetForm() {
    setPeriodStart(thisMonday);
    setPeriodLength("7");
    setTitle("");
  }

  function handleCreate() {
    if (!activeFacilityId || !user?.organizationId || !user?.id) return;
    createSchedule.mutate(
      {
        organization_id: user.organizationId,
        facility_id: activeFacilityId,
        title: title.trim() || null,
        period_start: periodStart,
        period_end: periodEnd,
        created_by: user.id,
      },
      {
        onSuccess: (created) => {
          toast({ title: "Schedule created" });
          setShowCreate(false);
          resetForm();
          navigate(`/app/schedule/${created.id}`);
        },
        onError: (e: Error) => toast({ title: "Failed to create schedule", description: e.message, variant: "destructive" }),
      }
    );
  }

  const sorted = [...(schedules ?? [])].sort((a, b) => b.period_start.localeCompare(a.period_start));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Schedule</h1>
          <p className="text-muted-foreground">
            Build shift schedules that auto-fill from each employee's typical shift and unit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/app/schedule/setup")}>
            <Settings2 className="h-4 w-4 mr-2" />
            Shifts, Units &amp; Patterns
          </Button>
          <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild>
              <Button disabled={!activeFacilityId}>
                <Plus className="h-4 w-4 mr-2" />
                New Schedule
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create Schedule</DialogTitle>
                <DialogDescription>
                  Pick a period -- you'll be able to auto-fill it from typical shifts on the next screen.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Title (optional)</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Week of Jul 6" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="periodStart">Starts</Label>
                    <Input id="periodStart" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Length</Label>
                    <Select value={periodLength} onValueChange={(v) => setPeriodLength(v as "7" | "14")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7">1 Week</SelectItem>
                        <SelectItem value="14">2 Weeks</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setPeriodStart(thisMonday)}>
                    This Week
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setPeriodStart(addDaysIso(thisMonday, 7))}>
                    Next Week
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatDateLabel(periodStart)} &ndash; {formatDateLabel(periodEnd)}
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createSchedule.isPending}>
                  {createSchedule.isPending ? "Creating..." : "Create Schedule"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground shrink-0">Facility</Label>
        <Select value={activeFacilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select a facility" />
          </SelectTrigger>
          <SelectContent>
            {(facilities ?? []).map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarDays className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No schedules yet</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Create a schedule, then auto-fill it from each employee's typical shift and unit.
            </p>
            <Button onClick={() => setShowCreate(true)} disabled={!activeFacilityId}>
              <Plus className="h-4 w-4 mr-2" />
              New Schedule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((s: Schedule) => (
            <Card
              key={s.id}
              className="cursor-pointer hover:shadow-md transition-shadow group"
              onClick={() => navigate(`/app/schedule/${s.id}`)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base leading-snug pr-2">
                    {s.title || `${formatDateLabel(s.period_start)} – ${formatDateLabel(s.period_end)}`}
                  </CardTitle>
                  <Badge variant={s.status === "published" ? "default" : "secondary"}>{s.status}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{formatDateLabel(s.period_start)} &ndash; {formatDateLabel(s.period_end)}</span>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
