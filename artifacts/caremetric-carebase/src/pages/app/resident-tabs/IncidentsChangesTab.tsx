import { useState } from "react";
import { Link } from "wouter";
import { Activity, AlertTriangle, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LogChangeOfConditionDialog } from "@/components/residents/LogChangeOfConditionDialog";
import { useListIncidents } from "@/hooks/useIncidents";
import { useListResidentChangeEvents } from "@/hooks/useResidentChangeEvents";
import { humanize } from "@/lib/utils";
import type { ResidentTabProps } from "./types";

export default function IncidentsChangesTab({ resident, canManage, isTrackedFacilityType }: ResidentTabProps) {
  const { data: incidents, isLoading: incidentsLoading } = useListIncidents({ residentId: resident.id });
  const { data: changeEvents, isLoading: changesLoading } = useListResidentChangeEvents({ residentId: resident.id });
  const [showChangeDialog, setShowChangeDialog] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Changes in condition</CardTitle>
              <CardDescription>Structured condition changes with notification, monitoring, and follow-up state.</CardDescription>
            </div>
            {canManage && isTrackedFacilityType && (
              <Button variant="outline" size="sm" onClick={() => setShowChangeDialog(true)}>
                <TriangleAlert className="mr-2 h-3.5 w-3.5" /> Log change of condition
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {changesLoading ? (
            <Skeleton className="h-10" />
          ) : !changeEvents?.length ? (
            <p className="text-sm text-muted-foreground">No condition changes recorded for this resident.</p>
          ) : (
            <div className="space-y-2">
              {changeEvents.map((event) => (
                <Link key={event.id} href={`/app/change-of-condition/${event.id}`} className="block rounded-lg border p-2 text-sm hover:bg-muted">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{humanize(event.category)}</span>
                    <Badge variant={event.status === "closed" ? "outline" : "secondary"}>{humanize(event.status)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Identified {new Date(event.identified_at).toLocaleDateString()}
                    {event.follow_up_due_at ? ` · follow-up due ${new Date(event.follow_up_due_at).toLocaleDateString()}` : ""}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Incidents</CardTitle>
          <CardDescription>Reportable events recorded against this resident.</CardDescription>
        </CardHeader>
        <CardContent>
          {incidentsLoading ? (
            <Skeleton className="h-10" />
          ) : !incidents?.length ? (
            <p className="text-sm text-muted-foreground">No incidents recorded for this resident.</p>
          ) : (
            <div className="space-y-2">
              {incidents.map((incident) => (
                <Link key={incident.id} href={`/app/incidents/${incident.id}`} className="block rounded-lg border p-2 text-sm hover:bg-muted">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{humanize(incident.incident_type)}</span>
                    <Badge variant={incident.status === "closed" ? "outline" : "secondary"}>{humanize(incident.status)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Occurred {new Date(incident.occurred_at).toLocaleDateString()} · severity {humanize(incident.severity)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <LogChangeOfConditionDialog open={showChangeDialog} onOpenChange={setShowChangeDialog} residentId={resident.id} />
    </div>
  );
}
