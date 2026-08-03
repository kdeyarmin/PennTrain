import { useState } from "react";
import { Link } from "wouter";
import {
  ClipboardCheck, ClipboardList, HandHeart, HeartPulse, MessageSquareWarning, Repeat, TriangleAlert, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { usePageTitle } from "@/lib/pageTitle";
import { useAuth } from "@/lib/auth";
import { useResidentServiceTaskQueue } from "@/hooks/useResidentServiceTasks";
import { DocumentCareDialog } from "@/components/residents/DocumentCareDialog";
import { UnscheduledServiceDialog } from "@/components/residents/UnscheduledServiceDialog";
import { UnsyncedDraftsPanel } from "@/components/residents/UnsyncedDraftsPanel";
import { SERVICE_TASK_KIND_LABELS, type ServiceTaskKind } from "@/lib/serviceDeliveryContract";

/** Flat shape returned by get_resident_service_task_queue -- not a nested requirement object. */
interface FloorTask {
  id: string;
  organization_id: string;
  facility_id: string;
  service_name: string;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  resident_id: string;
  resident_name: string | null;
  resident_room: string | null;
  special_instructions: string | null;
  requires_two_staff: boolean | null;
  task_kind: string | null;
  acceptable_completion_responses: string[] | null;
  refusal_handling: string | null;
}

const ACTIONS = [
  { key: "assignment", label: "My assignment", icon: Users, description: "Who you are covering this shift." },
  { key: "tasks", label: "Resident tasks", icon: ClipboardList, description: "What is due, and when." },
  { key: "document", label: "Document care", icon: ClipboardCheck, description: "Record what you did." },
  { key: "concern", label: "Report a concern", icon: MessageSquareWarning, description: "Something is not right." },
  { key: "handoff", label: "Shift handoff", icon: Repeat, description: "Pass it on at the end." },
] as const;

function timeWindow(task: FloorTask): string {
  const start = new Date(task.scheduled_start);
  const end = new Date(task.scheduled_end);
  const fmt = (value: Date) => value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function residentName(task: FloorTask): string {
  return task.resident_name?.trim() || "Resident";
}

function initials(task: FloorTask): string {
  const parts = residentName(task).split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2
    ? `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`
    : parts[0]?.slice(0, 2) ?? "?";
  return letters.toUpperCase();
}

/**
 * CareBase Floor. Five large actions and a task card that shows only what a direct-care employee
 * needs at the bedside: who, where, what, when, how, and any safety alert.
 *
 * What this surface deliberately does NOT show is as important as what it does: no compliance
 * status, no work-item metadata, no regulatory citation, no plan version. Those belong to the
 * manager-facing record. An aide holding a phone in a corridor needs the next action, not the
 * evidence trail behind it.
 */
export default function Floor() {
  usePageTitle("Floor");
  const { user } = useAuth();
  const [section, setSection] = useState<(typeof ACTIONS)[number]["key"]>("tasks");
  const [documenting, setDocumenting] = useState<FloorTask | null>(null);
  const [unscheduledFor, setUnscheduledFor] = useState<FloorTask | null>(null);

  // The queue rejects a zero-width window, so this spans the whole local day rather than passing
  // one date for both bounds. The floor cares about today; a wider window would bury what is
  // actually due behind history.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const queue = useResidentServiceTaskQueue({
    from: dayStart.toISOString(),
    through: dayEnd.toISOString(),
    status: "scheduled",
  });
  const tasks = (queue.data ?? []) as unknown as FloorTask[];

  return (
    <div className="space-y-5 pb-24">
      <div>
        <h1 className="text-2xl font-bold">Floor</h1>
        <p className="text-sm text-muted-foreground">
          {user?.firstName ? `${user.firstName}, here's your shift.` : "Here's your shift."}
        </p>
      </div>

      <UnsyncedDraftsPanel />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {ACTIONS.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={() => setSection(action.key)}
            aria-pressed={section === action.key}
            className={`flex min-h-24 flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
              section === action.key ? "border-primary bg-primary/5" : "hover:bg-muted"
            }`}
          >
            <action.icon className="h-6 w-6 shrink-0" />
            <span className="text-sm font-semibold leading-tight">{action.label}</span>
            <span className="text-[11px] leading-tight text-muted-foreground">{action.description}</span>
          </button>
        ))}
      </div>

      {section === "tasks" || section === "document" ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Due now</CardTitle>
                <CardDescription>Tap a task to document it.</CardDescription>
              </div>
              {!queue.isLoading && <Badge variant="outline">{tasks.length} open</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {queue.isError ? (
              <QueryError what="your task list" error={queue.error} onRetry={() => void queue.refetch()} />
            ) : queue.isLoading ? (
              <>
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </>
            ) : tasks.length === 0 ? (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nothing due right now.
              </p>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="rounded-lg border p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-base font-semibold text-primary">
                      {initials(task)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-base font-semibold">{residentName(task)}</span>
                        {task.resident_room && <Badge variant="outline">Room {task.resident_room}</Badge>}
                      </div>
                      <p className="mt-0.5 text-sm">{task.service_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {timeWindow(task)}
                        {task.task_kind
                          ? ` · ${SERVICE_TASK_KIND_LABELS[task.task_kind as ServiceTaskKind] ?? task.task_kind}`
                          : ""}
                      </p>
                      {task.special_instructions && (
                        <p className="mt-1 text-sm text-muted-foreground">{task.special_instructions}</p>
                      )}
                      {task.requires_two_staff && (
                        <p className="mt-1 flex items-center gap-1 text-sm font-medium text-destructive">
                          <TriangleAlert className="h-4 w-4 shrink-0" /> Two staff required
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button className="h-12 flex-1" onClick={() => setDocumenting(task)}>Document</Button>
                    <Button variant="outline" className="h-12" onClick={() => setUnscheduledFor(task)}>
                      <HandHeart className="mr-2 h-4 w-4" /> Extra care
                    </Button>
                    <Button variant="outline" className="h-12" asChild>
                      <Link href={`/me/residents/${task.resident_id}`}>
                        <HeartPulse className="mr-2 h-4 w-4" /> Chart
                      </Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      {section === "assignment" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My assignment</CardTitle>
            <CardDescription>Your shift, residents, and unit.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/me/shift" className="inline-flex h-12 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted">
              Open my shift
            </Link>
          </CardContent>
        </Card>
      )}

      {section === "concern" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Report a concern</CardTitle>
            <CardDescription>Something about a resident has changed, or something is not safe.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href="/me/change-of-condition" className="inline-flex h-12 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted">
              Change in a resident
            </Link>
            <Link href="/me/shift" className="inline-flex h-12 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted">
              Safety / maintenance handoff
            </Link>
            <Link href="/me/work" className="inline-flex h-12 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted">
              My open work
            </Link>
          </CardContent>
        </Card>
      )}

      {section === "handoff" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shift handoff</CardTitle>
            <CardDescription>What the next shift needs to know.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/me/shift" className="inline-flex h-12 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted">
              Open handoff
            </Link>
          </CardContent>
        </Card>
      )}

      {documenting && (
        <DocumentCareDialog
          open={!!documenting}
          onOpenChange={(open) => !open && setDocumenting(null)}
          task={{
            id: documenting.id,
            serviceName: documenting.service_name,
            residentName: residentName(documenting),
            room: documenting.resident_room,
            taskKind: documenting.task_kind,
            acceptableResponses: documenting.acceptable_completion_responses,
            instructions: documenting.special_instructions,
            refusalHandling: documenting.refusal_handling,
            residentId: documenting.resident_id,
            organizationId: documenting.organization_id,
            facilityId: documenting.facility_id,
            scheduledStart: documenting.scheduled_start,
            scheduledEnd: documenting.scheduled_end,
          }}
        />
      )}

      {unscheduledFor && (
        <UnscheduledServiceDialog
          open={!!unscheduledFor}
          onOpenChange={(open) => !open && setUnscheduledFor(null)}
          residentId={unscheduledFor.resident_id}
          residentName={residentName(unscheduledFor)}
          organizationId={unscheduledFor.organization_id}
          facilityId={unscheduledFor.facility_id}
        />
      )}
    </div>
  );
}
