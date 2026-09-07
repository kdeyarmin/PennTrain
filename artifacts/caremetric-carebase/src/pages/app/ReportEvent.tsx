import { Link } from "wouter";
import {
  AlertTriangle, MessageSquareWarning, ShieldAlert, ChevronRight, Siren,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SurfacePurpose } from "@/components/SurfacePurpose";
import { useAuth } from "@/lib/auth";

/**
 * Single "something happened" chooser for managers. Routes into the correct reporting rail
 * (incident / complaint / confidential) so floor staff don't have to know the product taxonomy.
 */
export default function ReportEvent() {
  const { user } = useAuth();
  const canManage = ["org_admin", "facility_manager", "platform_admin"].includes(user?.role ?? "");
  // BACKLOG J74. This route admits auditors (REPORTS_VIEW_ROLES in App.tsx) and the sidebar and
  // search both offer it to them -- but the first two doors are locked on the other side.
  // `Incidents.tsx` only honours ?action=add when `canManage` (org_admin / facility_manager) and
  // `Complaints.tsx` only when the viewer is not an auditor, so an auditor picked a card, arrived
  // on a list page, and no form opened and nothing said why. An auditor reviews these records; they
  // do not file them. So the two write doors become review doors for that role -- the same page,
  // without the ?action=add that will be ignored, and labelled for what it actually does.
  const canFileIncident = ["org_admin", "facility_manager"].includes(user?.role ?? "");
  const canFileComplaint = user?.role !== "auditor";
  const reviewOnly = !canFileIncident && !canFileComplaint;

  const options = [
    {
      href: canFileIncident ? "/app/incidents?action=add" : "/app/incidents",
      title: canFileIncident ? "Reportable incident" : "Reportable incidents",
      description: canFileIncident
        ? "Death, elopement, abuse/neglect allegation, med error, injury, fire, or other DHS-reportable event."
        : "Review the DHS-reportable incident register. Filing an incident is a facility manager or organization administrator action.",
      icon: AlertTriangle,
      tone: "text-destructive",
      bg: "bg-destructive/10",
      badge: canFileIncident ? "Incidents" : "Incidents · review",
    },
    {
      href: canFileComplaint ? "/app/complaints?action=add" : "/app/complaints",
      title: canFileComplaint ? "Complaint or grievance" : "Complaints and grievances",
      description: canFileComplaint
        ? "Resident, family, or staff complaint — rights, care quality, billing dispute, or similar."
        : "Review recorded complaints and grievances. Recording a new one is a facility action.",
      icon: MessageSquareWarning,
      tone: "text-amber-700",
      bg: "bg-amber-50",
      badge: canFileComplaint ? "Complaints" : "Complaints · review",
    },
    {
      href: "/app/confidential-incidents",
      title: "Confidential / anonymous safety report",
      description: "Near-miss, whistleblower, or sensitive report that should stay restricted to investigators.",
      icon: ShieldAlert,
      tone: "text-violet-700",
      bg: "bg-violet-50",
      badge: "Confidential",
    },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Guided</Badge>
          <span className="text-xs text-muted-foreground">Pick the type — we open the right form.</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Siren className="h-6 w-6 text-primary" />
          Report an event
        </h1>
        <p className="text-muted-foreground mt-1">
          {reviewOnly
            ? "One entry point for the incident, complaint, and confidential safety-report records. Your role reviews these; it does not file them."
            : "One entry point for incidents, complaints, and confidential safety reports."}
        </p>
      </div>

      <SurfacePurpose
        purpose={reviewOnly
          ? "This chooser only routes you — and for your role it routes to the registers, because filing an incident or a complaint is a facility action."
          : "This chooser only routes you — it does not replace the incident, complaint, or confidential record itself."}
      />

      <div className="grid gap-4 md:grid-cols-3">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <Link key={option.href} href={option.href} className="group block h-full">
              <Card className="h-full transition-all hover:border-primary/40 hover:shadow-sm">
                <CardHeader className="pb-2">
                  <div className={`mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl ${option.bg}`}>
                    <Icon className={`h-5 w-5 ${option.tone}`} />
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{option.title}</CardTitle>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <Badge variant="outline" className="w-fit text-[11px]">{option.badge}</Badge>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">{option.description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {canManage && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Need the open queues instead? Jump straight to work already in progress.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/app/incidents" className="text-sm font-medium text-primary hover:underline">Open incidents</Link>
              <span className="text-muted-foreground">·</span>
              <Link href="/app/complaints" className="text-sm font-medium text-primary hover:underline">Complaints</Link>
              <span className="text-muted-foreground">·</span>
              <Link href="/app/work" className="text-sm font-medium text-primary hover:underline">Work queue</Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
