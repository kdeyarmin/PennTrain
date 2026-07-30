import { useGetPlatformAdminDashboardPage, useGetPlatformHealth } from "@/hooks/usePlatformHealth";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/StatCard";
import {
  Building2,
  Users,
  AlertCircle,
  CheckCircle,
  TrendingUp,
  ChevronRight,
  Send,
  Sparkles,
  Video,
  Ban,
  LifeBuoy,
  Rocket,
  Settings,
  ShieldCheck,
  BookOpen,
  PlayCircle,
  ClipboardList,
  CalendarCheck,
  FileCheck,
  ShieldAlert,
  Database,
  Activity,
  ClipboardCheck,
  Gavel,
  GraduationCap,
} from "lucide-react";
import { Link } from "wouter";

export default function AdminDashboard() {
  const { data: health, isLoading: healthLoading } = useGetPlatformHealth();
  const { data: dashboardPage, isLoading: dashboardLoading } = useGetPlatformAdminDashboardPage();

  const orgsByStatus = health?.orgsByStatus ?? {};
  const totalOrgs = Object.values(orgsByStatus).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const activeOrgs = Number(orgsByStatus.active ?? 0);
  const trialOrgs = Number(orgsByStatus.trial ?? 0);
  const pastDueOrgs = Number(orgsByStatus.past_due ?? 0);
  const suspendedOrgs = Number(orgsByStatus.suspended ?? 0);
  const openSupportTickets = dashboardPage?.openSupportTickets ?? 0;
  const urgentWorkItems =
    (health?.notificationDeliveriesFailed ?? 0)
    + (health?.aiGenerationsFailed ?? 0)
    + (health?.systemJobsFailed ?? 0)
    + (health?.systemJobsStale ?? 0)
    + openSupportTickets
    + pastDueOrgs;
  const atRiskOrganizations = (dashboardPage?.atRiskOrganizations ?? []).slice(0, 4);
  const organizationsPage = dashboardPage?.organizationsPage ?? [];
  const tenantHealthScores = (dashboardPage?.tenantHealthScores ?? []).slice(0, 5);
  const inspectionReadinessScores = (dashboardPage?.inspectionReadinessScores ?? []).slice(0, 5);
  const coursesNeedingAttention = (dashboardPage?.coursesNeedingAttention ?? []).slice(0, 5);
  const missingOrgContacts = dashboardPage?.missingOrgContacts ?? 0;
  const facilitiesMissingLicense = dashboardPage?.facilitiesMissingLicense ?? 0;
  const facilitiesMissingAddress = dashboardPage?.facilitiesMissingAddress ?? 0;
  const organizationsWithoutAdmin = dashboardPage?.organizationsWithoutAdmin ?? 0;
  const employeesMissingEmail = health?.employeesMissingEmail ?? 0;
  const employeesMissingFacility = health?.employeesMissingFacility ?? 0;
  const expiredCredentials = health?.expiredCredentials ?? 0;
  const expiringCredentials = health?.expiringCredentialsWithin30Days ?? 0;
  const openIncidents = health?.openIncidents ?? 0;
  const openViolations = health?.openViolations ?? 0;
  const openCorrectiveActions = health?.openCorrectiveActions ?? 0;
  const overdueCorrectiveActions = health?.overdueCorrectiveActions ?? 0;
  const publishedCourses = health?.publishedCourses ?? 0;
  const draftCourses = health?.draftCourses ?? 0;
  const incompleteAssignments = health?.incompleteCourseAssignments ?? 0;
  const overdueAssignments = health?.overdueCourseAssignments ?? 0;
  const overdueTrainingRecords = health?.overdueTrainingRecords ?? 0;
  const pendingAttestations = health?.pendingPolicyAttestations ?? 0;
  const overdueAttestations = health?.overduePolicyAttestations ?? 0;

  const complianceTimelineIconByKey = {
    incident: AlertCircle,
    violation: Gavel,
    alert: ShieldAlert,
    corrective_action: ClipboardCheck,
  } as const;
  const complianceTimelineItems = (dashboardPage?.complianceTimelineItems ?? []).slice(0, 6).map((item) => ({
    ...item,
    Icon: complianceTimelineIconByKey[item.icon] ?? AlertCircle,
  }));

  const launchActions = [
    {
      href: "/admin/organizations",
      label: "Set up an organization",
      description: "Create tenants, assign packages, and open the customer workspace.",
      Icon: Building2,
    },
    {
      href: "/admin/users",
      label: "Invite operators",
      description: "Add org admins, trainers, auditors, and support users from one place.",
      Icon: Users,
    },
    {
      href: "/admin/courses/new-ai",
      label: "Build training",
      description: "Generate or launch required courses for teams that need to get running.",
      Icon: Sparkles,
    },
    {
      href: "/admin/settings",
      label: "Control platform switches",
      description: "Manage signup, maintenance mode, and AI spend controls before rollout.",
      Icon: Settings,
    },
  ];

  const runSteps = [
    "Create or verify the customer organization and package.",
    "Add the first admin users, then confirm facilities and employee imports.",
    "Publish required courses and check assignments from the training views.",
    "Monitor failed notifications, support tickets, and audit activity after launch.",
  ];

  const controlRoomSections = [
    {
      title: "Launch a customer",
      description: "Everything needed to take a tenant from signed contract to first login.",
      Icon: Rocket,
      items: [
        { href: "/admin/organizations", label: "Create organization and package" },
        { href: "/admin/facilities", label: "Verify facilities" },
        { href: "/admin/users", label: "Invite customer admins" },
      ],
    },
    {
      title: "Run daily operations",
      description: "Queues platform operators should clear before customer work backs up.",
      Icon: ClipboardList,
      items: [
        { href: "/admin/support-tickets?status=open", label: "Open support tickets" },
        { href: "/admin/notifications?status=failed", label: "Failed notification delivery" },
        { href: "/admin/audit", label: "Audit log review" },
      ],
    },
    {
      title: "Keep training moving",
      description: "Shortcuts for creating required content and checking that employees can complete assignments.",
      Icon: CalendarCheck,
      items: [
        { href: "/admin/courses", label: "Training content catalog" },
        { href: "/admin/courses/new-ai", label: "AI training builder" },
        { href: "/admin/ai-generations", label: "AI generation status" },
      ],
    },
  ];

  const dataQualityChecks = [
    {
      label: "Organizations missing contact owner",
      count: missingOrgContacts,
      href: "/admin/organizations",
      guidance: "Add contact name and email before kickoff so launch blockers have an owner.",
    },
    {
      label: "Facilities missing license numbers",
      count: facilitiesMissingLicense,
      href: "/admin/facilities",
      guidance: "License numbers strengthen inspection packets and facility-level exports.",
    },
    {
      label: "Facilities missing address details",
      count: facilitiesMissingAddress,
      href: "/admin/facilities",
      guidance: "Complete address fields before scheduling, reports, and compliance binder exports.",
    },
    {
      label: "Active employees missing email",
      count: employeesMissingEmail,
      href: "/admin/employees",
      guidance: "Email is needed for assignment notifications, password recovery, and reminders.",
    },
    {
      label: "Active employees missing facility",
      count: employeesMissingFacility,
      href: "/admin/employees",
      guidance: "Facility assignment drives scoped compliance, schedules, and manager visibility.",
    },
    {
      label: "Organizations without active org admin",
      count: organizationsWithoutAdmin,
      href: "/admin/users",
      guidance: "Every live tenant should have at least one active org admin for self-service operations.",
    },
  ];

  const credentialControlItems = [
    { label: "Expired credentials", count: expiredCredentials, href: "/admin/employees", severity: "high" },
    { label: "Expiring in 30 days", count: expiringCredentials, href: "/admin/employees", severity: "medium" },
    { label: "Open incidents", count: openIncidents, href: "/admin/alerts", severity: "medium" },
    { label: "Open violations / POCs", count: openViolations, href: "/admin/alerts", severity: "high" },
    { label: "Open corrective actions", count: openCorrectiveActions, href: "/admin/alerts", severity: "medium" },
    { label: "Overdue corrective actions", count: overdueCorrectiveActions, href: "/admin/alerts", severity: "high" },
  ];

  const trainingOptimizationItems = [
    { label: "Published courses", count: publishedCourses, href: "/admin/courses", severity: "good" },
    { label: "Draft / unpublished courses", count: draftCourses, href: "/admin/courses", severity: "medium" },
    { label: "Incomplete assignments", count: incompleteAssignments, href: "/admin/courses", severity: "medium" },
    { label: "Overdue assignments", count: overdueAssignments, href: "/admin/courses", severity: "high" },
    { label: "Overdue training records", count: overdueTrainingRecords, href: "/admin/employees", severity: "high" },
    { label: "Pending attestations", count: pendingAttestations, href: "/admin/help-content", severity: "medium" },
    { label: "Overdue attestations", count: overdueAttestations, href: "/admin/help-content", severity: "high" },
    { label: "Training path templates", count: dashboardPage?.trainingPlansCount ?? 0, href: "/admin/courses", severity: "good" },
  ];

  const employeeTaskBacklog = [
    { label: "Training assignments overdue", count: overdueAssignments, href: "/admin/courses", guidance: "Use this to prioritize reminders or reassignments." },
    { label: "Training records past due", count: overdueTrainingRecords, href: "/admin/employees", guidance: "Expired records should drive manager follow-up." },
    { label: "Policy attestations overdue", count: overdueAttestations, href: "/admin/help-content", guidance: "Confirm campaigns and send reminders for unsigned policies." },
  ];

  const domainReviewCards = [
    {
      title: "Tenant Operations",
      Icon: Building2,
      status: `${activeOrgs}/${totalOrgs} active`,
      finding: "Centralize org setup, packages, facilities, and subscription follow-up.",
      enhancement: "Use the tenant watchlist plus org shortcuts to unblock launches faster.",
      links: [
        { href: "/admin/organizations", label: "Organizations" },
        { href: "/admin/packages", label: "Packages" },
        { href: "/admin/facilities", label: "Facilities" },
      ],
    },
    {
      title: "People & Access",
      Icon: Users,
      status: `${health?.totalEmployees ?? 0} employees`,
      finding: "Admins need one path to inspect employees and control application users.",
      enhancement: "Pair employee directory review with user-role review before every launch.",
      links: [
        { href: "/admin/employees", label: "Employees" },
        { href: "/admin/users", label: "Users" },
        { href: "/admin/audit", label: "Audit trail" },
      ],
    },
    {
      title: "Training & Content",
      Icon: BookOpen,
      status: `${health?.aiGenerationsFailed ?? 0} AI failures`,
      finding: "Course authoring and AI generation health should be reviewed together.",
      enhancement: "Keep training-content creation, AI logs, and help content one click away.",
      links: [
        { href: "/admin/courses", label: "Training content" },
        { href: "/admin/courses/new-ai", label: "New AI training" },
        { href: "/admin/help-content", label: "Help content" },
      ],
    },
    {
      title: "Compliance Oversight",
      Icon: ShieldAlert,
      status: `${suspendedOrgs} suspended`,
      finding: "Platform admins need quick access to alerts, audit documentation, and governance.",
      enhancement: "Review alerts and security governance before enabling troubled tenants.",
      links: [
        { href: "/admin/alerts", label: "Alerts" },
        { href: "/admin/security", label: "Security" },
        { href: "/admin/audit", label: "Audit log" },
      ],
    },
    {
      title: "Communications & Support",
      Icon: LifeBuoy,
      status: `${openSupportTickets} open tickets`,
      finding: "Support and failed notification delivery directly affect employee completion.",
      enhancement: "Clear failed deliveries and open tickets from the same operating surface.",
      links: [
        { href: "/admin/support-tickets?status=open", label: "Support queue" },
        { href: "/admin/notifications?status=failed", label: "Failed delivery" },
        { href: "/admin/notifications", label: "All notifications" },
      ],
    },
    {
      title: "Platform Governance",
      Icon: Settings,
      status: "Settings ready",
      finding: "Feature flags, maintenance controls, and system health should be obvious.",
      enhancement: "Keep platform settings visible next to health and operational queues.",
      links: [
        { href: "/admin/settings", label: "Settings" },
        { href: "/admin/security", label: "Governance" },
        { href: "/admin/ai-generations", label: "AI spend" },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="page-header !mb-0">
        <h1>Platform Dashboard</h1>
        <p>Overview of all organizations, system health, and launch controls.</p>
      </div>

      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background">
        <CardContent className="p-6">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div className="space-y-4">
              <Badge variant={urgentWorkItems > 0 ? "destructive" : "secondary"} className="w-fit">
                {urgentWorkItems > 0 ? `${urgentWorkItems} item${urgentWorkItems === 1 ? "" : "s"} need attention` : "Ready to operate"}
              </Badge>
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-foreground">Super admin command center</h2>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  Run CareMetric CareBase from this portal: launch customers, manage access, publish training content, and watch
                  operational health without hunting through separate menus.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/admin/organizations">
                  <Button>
                    <Rocket className="mr-2 h-4 w-4" /> Launch customer
                  </Button>
                </Link>
                <Link href="/admin/support-tickets?status=open">
                  <Button variant="outline">
                    <LifeBuoy className="mr-2 h-4 w-4" /> Review support queue
                  </Button>
                </Link>
              </div>
            </div>
            <div className="rounded-xl border bg-background/80 p-4 shadow-sm">
              <div className="flex items-center gap-2 font-semibold">
                <PlayCircle className="h-4 w-4 text-primary" /> Recommended run order
              </div>
              <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
                {runSteps.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total Organizations" value={totalOrgs} icon={Building2} tone="primary" />
        <StatCard label="Active Subscriptions" value={activeOrgs} icon={CheckCircle} tone="success" />
        <StatCard label="Trial Accounts" value={trialOrgs} icon={TrendingUp} tone="info" />
        <StatCard label="Past Due" value={pastDueOrgs} icon={AlertCircle} tone="warning" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {launchActions.map(({ href, label, description, Icon }) => (
          <Link key={href} href={href} className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/40">
            <div className="flex items-start justify-between gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </div>
            <h3 className="mt-4 font-semibold text-foreground">{label}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Operating Priorities</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <Link href="/admin/notifications?status=failed" className="rounded-lg border p-4 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2 text-sm font-medium"><Send className="h-4 w-4 text-red-600" /> Failed notifications</div>
              <p className="mt-2 text-2xl font-bold">{health?.notificationDeliveriesFailed ?? 0}</p>
              <p className="text-xs text-muted-foreground">Fix delivery issues before users miss required training reminders.</p>
            </Link>
            <Link href="/admin/security" className="rounded-lg border p-4 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-blue-600" /> Governance checks</div>
              <p className="mt-2 text-2xl font-bold">{suspendedOrgs}</p>
              <p className="text-xs text-muted-foreground">Suspended organizations to review before enabling or expanding access.</p>
            </Link>
            <Link href="/admin/help-content" className="rounded-lg border p-4 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2 text-sm font-medium"><BookOpen className="h-4 w-4 text-green-600" /> Operator guidance</div>
              <p className="mt-2 text-2xl font-bold">Help</p>
              <p className="text-xs text-muted-foreground">Keep support articles current so teams can self-serve day-to-day operations.</p>
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
        <Card>
          <CardHeader>
            <CardTitle>Control Room</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 lg:grid-cols-3">
              {controlRoomSections.map(({ title, description, Icon, items }) => (
                <div key={title} className="rounded-lg border p-4">
                  <div className="flex items-center gap-2 font-semibold">
                    <Icon className="h-4 w-4 text-primary" /> {title}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{description}</p>
                  <div className="mt-4 space-y-2">
                    {items.map((item) => (
                      <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm font-medium hover:bg-muted">
                        <span>{item.label}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tenant Watchlist</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {atRiskOrganizations.map((org) => (
                <Link key={org.id} href={`/admin/organizations/${org.id}`} className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{org.name}</p>
                    <p className="text-xs text-muted-foreground">{org.plan_name ?? "Standard"} plan</p>
                  </div>
                  <StatusBadge status={org.subscription_status ?? "active"} type="subscription" />
                </Link>
              ))}
              {atRiskOrganizations.length === 0 && (
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <FileCheck className="mx-auto h-5 w-5 text-green-600" />
                  <p className="mt-2 text-sm font-medium">No tenant follow-up needed</p>
                  <p className="text-xs text-muted-foreground">Trials, past-due, and suspended organizations will appear here.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /> Tenant Health Scores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {tenantHealthScores.map(({ id, name, score, facilityCount, employeeCount, adminCount }) => (
                <Link key={id} href={`/admin/organizations/${id}`} className="block rounded-lg border p-3 hover:bg-muted/50">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{name}</p>
                      <p className="text-xs text-muted-foreground">{facilityCount} facilities · {employeeCount} active employees · {adminCount} admins</p>
                    </div>
                    <Badge variant={score < 60 ? "destructive" : score < 85 ? "secondary" : "default"}>{score}/100</Badge>
                  </div>
                </Link>
              ))}
              {tenantHealthScores.length === 0 && (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No organizations available for scoring yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5 text-primary" /> Data Quality Center</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {dataQualityChecks.map((check) => (
                <Link key={check.label} href={check.href} className="rounded-lg border p-3 hover:bg-muted/50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{check.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{check.guidance}</p>
                    </div>
                    <Badge variant={check.count > 0 ? "destructive" : "secondary"}>{check.count}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phase 2 Compliance Automation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {credentialControlItems.map((item) => (
                  <Link key={item.label} href={item.href} className="rounded-lg border p-3 hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{item.label}</p>
                      <Badge variant={item.count > 0 && item.severity === "high" ? "destructive" : "secondary"}>{item.count}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" /> Inspection readiness scoring</div>
                <div className="mt-3 space-y-2">
                  {inspectionReadinessScores.map(({ id, name, score, outstandingItems, facilityIncidents, facilityViolations, facilityOverdueActions }) => (
                    <Link key={id} href={`/admin/facilities/${id}`} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 hover:bg-muted">
                      <div>
                        <p className="text-sm font-medium">{name}</p>
                        <p className="text-xs text-muted-foreground">{outstandingItems} inspection gaps · {facilityIncidents} incidents · {facilityViolations} violations · {facilityOverdueActions} overdue actions</p>
                      </div>
                      <Badge variant={score < 70 ? "destructive" : score < 90 ? "secondary" : "default"}>{score}/100</Badge>
                    </Link>
                  ))}
                  {inspectionReadinessScores.length === 0 && (
                    <p className="text-sm text-muted-foreground">No facilities available for readiness scoring.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" /> Compliance case timeline</div>
              <div className="mt-3 space-y-3">
                {complianceTimelineItems.map(({ id, label, date, href, status, Icon }) => (
                  <Link key={id} href={href} className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/50">
                    <Icon className="mt-0.5 h-4 w-4 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{date ? formatDateForDisplay(date) : "No date"}</p>
                    </div>
                    <Badge variant="outline" className="capitalize">{status?.replace(/_/g, " ") ?? "open"}</Badge>
                  </Link>
                ))}
                {complianceTimelineItems.length === 0 && (
                  <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No incidents, violations, alerts, or corrective actions found yet.</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phase 3 Training Optimization</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 xl:grid-cols-[0.8fr_0.6fr_0.6fr]">
            <div className="grid gap-3 sm:grid-cols-2">
              {trainingOptimizationItems.map((item) => (
                <Link key={item.label} href={item.href} className="rounded-lg border p-3 hover:bg-muted/50">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{item.label}</p>
                    <Badge variant={item.count > 0 && item.severity === "high" ? "destructive" : item.severity === "good" ? "default" : "secondary"}>{item.count}</Badge>
                  </div>
                </Link>
              ))}
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 font-semibold"><GraduationCap className="h-4 w-4 text-primary" /> Training assignment hotspots</div>
              <div className="mt-3 space-y-2">
                {coursesNeedingAttention.map((course) => (
                  <Link key={course.courseId} href={`/admin/courses/${course.courseId}`} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 hover:bg-muted">
                    <span className="truncate text-sm font-medium">{course.title}</span>
                    <Badge variant="secondary">{course.count}</Badge>
                  </Link>
                ))}
                {coursesNeedingAttention.length === 0 && (
                  <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No incomplete training-assignment hotspots found.</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4 text-primary" /> Employee task backlog</div>
              <div className="mt-3 space-y-2">
                {employeeTaskBacklog.map((item) => (
                  <Link key={item.label} href={item.href} className="block rounded-md border p-3 hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{item.label}</p>
                      <Badge variant={item.count > 0 ? "destructive" : "secondary"}>{item.count}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.guidance}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Domain Review & Enhancement Map</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {domainReviewCards.map(({ title, Icon, status, finding, enhancement, links }) => (
              <div key={title} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <Icon className="h-4 w-4 text-primary" /> {title}
                  </div>
                  <Badge variant="secondary">{status}</Badge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{finding}</p>
                <p className="mt-2 text-sm font-medium text-foreground">Enhancement: {enhancement}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {links.map((link) => (
                    <Link key={`${title}-${link.href}`} href={link.href}>
                      <Button variant="outline" size="sm">{link.label}</Button>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Link href="/admin/notifications?status=failed" className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <div className="h-9 w-9 rounded-md bg-red-100 flex items-center justify-center shrink-0">
                  <Send className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.notificationDeliveriesFailed ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Failed Deliveries</p>
                </div>
              </Link>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="h-9 w-9 rounded-md bg-amber-100 flex items-center justify-center shrink-0">
                  <Send className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.notificationDeliveriesPending ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Pending Deliveries</p>
                </div>
              </div>
              <Link href="/admin/system-jobs" className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <div className="h-9 w-9 rounded-md bg-red-100 flex items-center justify-center shrink-0">
                  <Activity className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">
                    {(health?.systemJobsFailed ?? 0) + (health?.systemJobsStale ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Failed / Stale Jobs</p>
                </div>
              </Link>
              <Link href="/admin/security" className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <div className="h-9 w-9 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
                  <ShieldCheck className="h-4 w-4 text-violet-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.auditCoverageMissing ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Audit Coverage Gaps</p>
                </div>
              </Link>
              <Link href="/admin/ai-generations" className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <div className="h-9 w-9 rounded-md bg-red-100 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.aiGenerationsFailed ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Failed AI Generations (30d)</p>
                </div>
              </Link>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="h-9 w-9 rounded-md bg-blue-100 flex items-center justify-center shrink-0">
                  <Video className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.heygenJobsInProgress ?? 0}</p>
                  <p className="text-xs text-muted-foreground">HeyGen Jobs In Progress</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="h-9 w-9 rounded-md bg-orange-100 flex items-center justify-center shrink-0">
                  <Ban className="h-4 w-4 text-orange-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.orgsByStatus?.suspended ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Suspended Orgs</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="h-9 w-9 rounded-md bg-green-100 flex items-center justify-center shrink-0">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.totalEmployees ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Total Employees</p>
                </div>
              </div>
              <Link href="/admin/support-tickets?status=open" className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <div className="h-9 w-9 rounded-md bg-amber-100 flex items-center justify-center shrink-0">
                  <LifeBuoy className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{openSupportTickets}</p>
                  <p className="text-xs text-muted-foreground">Open Support Tickets</p>
                </div>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Organizations</CardTitle>
          <Link href="/admin/organizations">
            <Button variant="outline" size="sm">
              View All <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {dashboardLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {organizationsPage.map(org => (
                <Link key={org.id} href={`/admin/organizations/${org.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer border">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{org.name}</p>
                        <p className="text-xs text-muted-foreground">{org.plan_name ?? "Standard"} plan</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={org.subscription_status ?? "active"} type="subscription" />
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
              {organizationsPage.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-4">No organizations found.</p>
              )}
              {/* This card is a bounded slice, not the full tenant list. Say so rather than
                  letting a truncated list read as "these are all the organizations". */}
              {organizationsPage.length > 0 && totalOrgs > organizationsPage.length && (
                <Link href="/admin/organizations" className="block pt-1">
                  <p className="text-muted-foreground text-xs text-center hover:underline">
                    Showing {organizationsPage.length} of {totalOrgs} organizations — view all
                  </p>
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
