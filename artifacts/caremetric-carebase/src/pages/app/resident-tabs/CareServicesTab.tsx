import { Link } from "wouter";
import { CalendarDays, ClipboardCheck, HeartPulse, Utensils } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Resident360MetricCard } from "@/components/residents/Resident360Summary";
import type { ResidentTabProps } from "./types";

/**
 * Care & services is intentionally a hub in this phase: service requirements and task instances are
 * owned by the care-delivery and calendar workspaces, and duplicating those tables here would create
 * a second surface to keep correct. The assessment-to-service engine phase gives this tab its own
 * resident-scoped service list; until then it links to the surfaces that hold the data rather than
 * showing a partial copy.
 */
export default function CareServicesTab({ resident, isPlatformRoute }: ResidentTabProps) {
  const links = [
    {
      href: `/app/resident-care-delivery?resident=${resident.id}`,
      icon: ClipboardCheck,
      label: "Care delivery",
      description: "Scheduled service tasks, completion, and exceptions.",
    },
    {
      href: `/app/resident-services-calendar?resident=${resident.id}`,
      icon: CalendarDays,
      label: "Services calendar",
      description: "Appointments, transport, and scheduled events.",
    },
    {
      href: `/app/dietary-operations?resident=${resident.id}`,
      icon: Utensils,
      label: "Dietary",
      description: "Diet order, texture, weights, and intake monitoring.",
    },
  ];

  return (
    <div className="space-y-6">
      <Resident360MetricCard residentId={resident.id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Care workspaces</CardTitle>
          <CardDescription>Each opens the workspace that owns the record, scoped to this resident.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {!isPlatformRoute && (
            <Link
              href={`/app/residents/${resident.id}/chart`}
              className="flex items-start gap-2 rounded-md border p-3 text-sm hover:bg-muted"
            >
              <HeartPulse className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="font-medium">Clinical chart</span>
                <span className="block text-xs text-muted-foreground">Observations, care plans, assessments, and notes.</span>
              </span>
            </Link>
          )}
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="flex items-start gap-2 rounded-md border p-3 text-sm hover:bg-muted">
              <link.icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="font-medium">{link.label}</span>
                <span className="block text-xs text-muted-foreground">{link.description}</span>
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
