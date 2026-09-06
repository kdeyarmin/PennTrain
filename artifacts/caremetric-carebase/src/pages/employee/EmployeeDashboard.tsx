import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { facilityDaysUntil, formatDateForDisplay, formatDueDistance, facilityYear } from "@/lib/dateUtils";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { summarizeCurrentTrainingCompliance } from "@/lib/complianceScore";
import { selectCurrentTrainingRecords } from "@/lib/currentTrainingRecords";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useListCompetencyRecords, useListCompetencyTemplates } from "@/hooks/useCompetencies";
import { useListCourseAssignments } from "@/hooks/useCourseAssignments";
import { useListCourses } from "@/hooks/useCourses";
import { useListPolicyAttestations, useListPolicyAttestationCampaigns, type PolicyAttestation } from "@/hooks/usePolicyAttestations";
import { useListPolicyDocuments } from "@/hooks/usePolicyDocuments";
import { useListShiftAssignments } from "@/hooks/useShiftAssignments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryError } from "@/components/QueryState";
import { RoleQuickStart } from "@/components/RoleQuickStart";
import {
  GraduationCap, CheckCircle, Clock, AlertTriangle, FileText, ClipboardCheck, BookOpen,
  CalendarClock, CalendarDays, MapPin, FileCheck2, FileCheck, Files, ShieldCheck, FileSignature,
  ChevronRight, HelpCircle, HeartPulse, type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { todayIso, formatDateLabel, formatTimeLabel } from "@/lib/scheduleDates";

interface DeadlineItem {
  id: string;
  kind: "course" | "training" | "practicum" | "attestation";
  label: string;
  dueDate: string;
  status: string;
  href?: string;
}

const DEADLINE_KIND_META: Record<DeadlineItem["kind"], { label: string; icon: LucideIcon }> = {
  course: { label: "Training assignment", icon: BookOpen },
  training: { label: "Training record", icon: GraduationCap },
  practicum: { label: "Practicum", icon: ClipboardCheck },
  attestation: { label: "Attestation", icon: FileCheck2 },
};

function competencyResultVariant(result: string): "default" | "destructive" | "secondary" {
  if (result === "met") return "default";
  if (result === "not_met") return "destructive";
  return "secondary"; // partial
}

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const currentYear = facilityYear();

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  // Training/practicum/competency/attestation/shift/assignment queries below are all gated on a
  // resolved employee id -- without `enabled`, each one fires once with employeeId undefined
  // (scoping to "no filter at all" rather than "nothing," since RLS alone doesn't stand in for a
  // missing employee_id filter) and again once `employee` resolves, doubling every request on
  // every dashboard load. See each hook's own comment for why `enabled`, not just the filter, is
  // required.
  const {
    data: records,
    isLoading: recordsLoading,
    isError: recordsError,
    error: recordsErrorDetail,
    refetch: refetchRecords,
  } = useListTrainingRecords(
    { employeeId: employee?.id },
    { enabled: !!employee?.id },
  );
  const { data: practicums, isLoading: practicumsLoading, isError: practicumsError, refetch: refetchPracticums } = useListPracticums(
    { employeeId: employee?.id, year: currentYear },
    { enabled: !!employee?.id },
  );
  const { data: trainingTypes } = useListTrainingTypes();
  const {
    data: courseAssignments,
    isLoading: assignmentsLoading,
    isError: assignmentsError,
    refetch: refetchAssignments,
  } = useListCourseAssignments({ employeeId: employee?.id }, { enabled: !!employee?.id });
  const { data: courses } = useListCourses();
  const courseTitleById = new Map((courses ?? []).map(c => [c.id, c.title]));

  // Competency records are trainer-authored/signed -- RLS gives an employee
  // read-only access to their own rows only (owns_employee() appears in the
  // SELECT policy but not insert/update), so this dashboard only ever reads
  // them here. There is no create/edit UI for competency records anywhere in
  // the employee-facing pages.
  const {
    data: competencyRecords,
    isLoading: competencyLoading,
    isError: competencyError,
    error: competencyErrorDetail,
    refetch: refetchCompetency,
  } = useListCompetencyRecords(
    { employeeId: employee?.id },
    { enabled: !!employee?.id },
  );
  const { data: competencyTemplates } = useListCompetencyTemplates();
  const competencyTemplateNameById = new Map((competencyTemplates ?? []).map((t) => [t.id, t.name]));
  const recentCompetencyRecords = [...(competencyRecords ?? [])]
    .sort((a, b) => b.evaluation_date.localeCompare(a.evaluation_date))
    .slice(0, 5);

  // Attestations due -- previously had zero presence on this dashboard (see the deadlines list
  // below), so an employee with overdue policy sign-offs had no signal here at all. Title
  // resolution mirrors MyAttestations.tsx's own titleFor() (campaign -> policy_document.title).
  const {
    data: attestations,
    isLoading: attestationsLoading,
    isError: attestationsError,
    refetch: refetchAttestations,
  } = useListPolicyAttestations(
    { employeeId: employee?.id },
    { enabled: !!employee?.id },
  );
  const { data: attestationCampaigns } = useListPolicyAttestationCampaigns({ organizationId: user?.organizationId ?? undefined });
  const { data: policyDocuments } = useListPolicyDocuments({ organizationId: user?.organizationId ?? undefined });
  const campaignById = new Map((attestationCampaigns ?? []).map((c) => [c.id, c]));
  const policyDocumentById = new Map((policyDocuments ?? []).map((d) => [d.id, d]));
  const attestationTitle = (a: PolicyAttestation) => {
    const campaign = campaignById.get(a.campaign_id);
    const doc = campaign ? policyDocumentById.get(campaign.policy_document_id) : undefined;
    return doc?.title ?? campaign?.name ?? "Policy Attestation";
  };
  const pendingAttestations = (attestations ?? []).filter(a => a.status === "pending");

  // Next published shift -- shift_assignments RLS already restricts an employee's own rows to
  // schedules with status = 'published' (see MySchedule.tsx, which uses the same
  // employeeId+fromDate filter and ascending shift_date/start_time order), so `shifts[0]` here is
  // simply the soonest upcoming published shift with no extra client-side filtering needed.
  const {
    data: shifts,
    isLoading: shiftsLoading,
    isError: shiftsError,
    error: shiftsErrorDetail,
    refetch: refetchShifts,
  } = useListShiftAssignments(
    { employeeId: employee?.id, fromDate: todayIso() },
    { enabled: !!employee?.id },
  );
  const nextShift = shifts?.[0];

  const typeNameById = new Map((trainingTypes ?? []).map(t => [t.id, t.name]));
  const trainingTypeName = (r: TrainingRecord) => typeNameById.get(r.training_type_id) ?? `Training #${r.id.slice(0, 8)}`;

  const isLoading = employeeLoading || recordsLoading;

  // One current record per (employee, training type). A renewal INSERTS a fresh
  // employee_training_records row and the nightly recalculation keeps grading the superseded one by
  // its own completion date, so it stays 'expired' forever (see currentTrainingRecords.ts). Counting
  // raw rows made this dashboard tell an employee who renewed everything that they had four expired
  // trainings, and put last cycle's rows in their deadline list with dates already months past.
  // summarizeCurrentTrainingCompliance is the shared counter the Dashboard and both compliance RPCs
  // agree with; the deadline list and the preview reduce through the same rule so all three read the
  // same history.
  const allRecords = useMemo(() => selectCurrentTrainingRecords(records ?? []), [records]);
  const trainingCounts = useMemo(() => summarizeCurrentTrainingCompliance(records ?? []), [records]);
  const compliant = trainingCounts.compliant;
  const expired = trainingCounts.expired;
  const dueSoon = trainingCounts.dueSoon;
  // Capped preview, same "cap at 5 + View All" treatment as the Competency Evaluations section
  // above -- this list otherwise renders every record (15-20+ rows) with no pagination.
  const recentRecords = allRecords.slice(0, 5);

  const myPracticum = practicums?.[0];

  // A single, sorted "what's next" list across the four deadline sources that otherwise live in
  // unrelated tables (course_assignments, employee_training_records, practicums,
  // policy_attestations) -- previously each only surfaced its own status in its own card (and
  // attestations had no presence here at all), so an employee had to check multiple places to see
  // everything coming due.
  const courseDeadlines: DeadlineItem[] = (courseAssignments ?? [])
    .filter(a => a.due_date && a.status !== "completed")
    .map(a => ({
      id: `course-${a.id}`,
      kind: "course",
      label: courseTitleById.get(a.course_id) ?? "Training",
      dueDate: a.due_date as string,
      status: a.status,
      href: `/me/courses/${a.id}`,
    }));
  const trainingDeadlines: DeadlineItem[] = allRecords
    .filter(r => (r.status === "due_soon" || r.status === "expired") && r.due_date)
    .map(r => ({
      id: `training-${r.id}`,
      kind: "training",
      label: trainingTypeName(r),
      dueDate: r.due_date as string,
      status: r.status,
      href: "/me/trainings",
    }));
  const practicumDeadlines: DeadlineItem[] =
    myPracticum && myPracticum.due_date && myPracticum.status !== "compliant"
      ? [{
          id: `practicum-${myPracticum.id}`,
          kind: "practicum",
          label: "Medication Administration Practicum",
          dueDate: myPracticum.due_date,
          status: myPracticum.status,
          href: "/me/trainings",
        }]
      : [];
  const attestationDeadlines: DeadlineItem[] = pendingAttestations
    .filter(a => a.due_date)
    .map(a => ({
      id: `attestation-${a.id}`,
      kind: "attestation",
      label: attestationTitle(a),
      dueDate: a.due_date as string,
      status: (a.due_date as string) < todayIso() ? "overdue" : "pending",
      href: "/me/attestations",
    }));
  const upcomingDeadlines = [...courseDeadlines, ...trainingDeadlines, ...practicumDeadlines, ...attestationDeadlines]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 8);

  // The deadlines card merges four sources; if any failed the list is silently incomplete, which
  // for a compliance to-do list is worse than saying so. Retry only re-fires what actually failed.
  const deadlineSourcesError = recordsError || assignmentsError || practicumsError || attestationsError;
  const retryDeadlineSources = () => {
    if (recordsError) refetchRecords();
    if (assignmentsError) refetchAssignments();
    if (practicumsError) refetchPracticums();
    if (attestationsError) refetchAttestations();
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Start here</Badge>
          <span className="text-xs text-muted-foreground">Your next due items are sorted by date.</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">My day</h1>
        <p className="text-muted-foreground">
          Welcome, {user?.firstName}. Finish overdue items first, then due-soon work, then keep credentials and signatures current.
        </p>
      </div>

      <RoleQuickStart
        role={user?.role}
        title="My quick start"
        description="A short checklist for finishing the work managers need to verify."
      />

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-primary" />
            Do these next
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Your simple inbox — courses, training, practicums, and policy signatures by due date.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-dashed bg-background/80 px-3 py-2.5 text-sm">
            <p className="font-medium">Get reminders on your phone</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add your mobile number and turn on text messages so due training and credentials reach you without opening a computer.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-2 h-8">
              <Link href="/account/notifications">Notification settings</Link>
            </Button>
          </div>
          {employeeLoading ? (
            <div className="h-16 bg-muted animate-pulse rounded" />
          ) : deadlineSourcesError ? (
            <QueryError what="your due items" onRetry={retryDeadlineSources} />
          ) : upcomingDeadlines.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              Nothing overdue or due soon. You're caught up — check your shift and credentials when you can.
            </p>
          ) : (
            <div className="space-y-2">
              {upcomingDeadlines.map((item) => {
                const Meta = DEADLINE_KIND_META[item.kind];
                const Icon = Meta.icon;
                const days = facilityDaysUntil(item.dueDate);
                const urgent = days !== null && days <= 7;
                const overdue = days !== null && days < 0;
                return (
                  <Link
                    key={item.id}
                    href={item.href ?? "/me"}
                    className={`flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5 transition hover:bg-muted/40 ${overdue ? "border-destructive/40" : urgent ? "border-amber-300" : ""}`}
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${overdue ? "text-destructive" : urgent ? "text-amber-600" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {Meta.label} · Due {formatDateForDisplay(item.dueDate)}
                          {formatDueDistance(item.dueDate) ? ` · ${formatDueDistance(item.dueDate)}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={item.status} />
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-medium">What should I do first?</p>
              <p className="text-sm text-muted-foreground">Complete overdue items first, then anything due soon. If a record looks wrong, upload documentation or contact your facility manager.</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm"><Link href="/me/help">Get help</Link></Button>
        </CardContent>
      </Card>

      {!employeeLoading && !employee ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground text-center">
              No employee profile is linked to this account yet. Contact your facility manager so your courses, schedule, credentials, and attestations can appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold">{isLoading || recordsError ? "—" : compliant}</p>
                    <p className="text-sm text-muted-foreground">Compliant</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Clock className="h-8 w-8 text-yellow-600" />
                  <div>
                    <p className="text-2xl font-bold">{isLoading || recordsError ? "—" : dueSoon}</p>
                    <p className="text-sm text-muted-foreground">Due Soon</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-8 w-8 text-red-600" />
                  <div>
                    <p className="text-2xl font-bold">{isLoading || recordsError ? "—" : expired}</p>
                    <p className="text-sm text-muted-foreground">Expired</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <FileCheck2 className="h-8 w-8 text-blue-600" />
                  <div>
                    <p className="text-2xl font-bold">{employeeLoading || attestationsLoading || attestationsError ? "—" : pendingAttestations.length}</p>
                    <p className="text-sm text-muted-foreground">Attestations Due</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="h-5 w-5" />
                  Annual Practicum ({currentYear})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {employeeLoading || practicumsLoading ? (
                  <div className="h-16 bg-muted animate-pulse rounded" />
                ) : practicumsError ? (
                  <QueryError what="annual practicum" onRetry={() => void refetchPracticums()} />
                ) : myPracticum ? (
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="font-medium text-sm">Medication Administration Practicum</p>
                      {myPracticum.completion_date && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Completed: {formatDateForDisplay(myPracticum.completion_date)}
                        </p>
                      )}
                    </div>
                    <StatusBadge status={myPracticum.status} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No practicum record for {currentYear}.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5" />
                  Next Shift
                </CardTitle>
              </CardHeader>
              <CardContent>
                {employeeLoading || shiftsLoading ? (
                  <div className="h-16 bg-muted animate-pulse rounded" />
                ) : shiftsError ? (
                  <QueryError what="your upcoming shifts" error={shiftsErrorDetail} onRetry={() => void refetchShifts()} />
                ) : nextShift ? (
                  <Link href="/me/schedule" className="block rounded-lg border p-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">
                          {formatDateLabel(nextShift.shift_date, { weekday: "long", month: "short", day: "numeric" })}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          {nextShift.shift_definitions?.name ? `${nextShift.shift_definitions.name} · ` : ""}
                          {formatTimeLabel(nextShift.start_time)}–{formatTimeLabel(nextShift.end_time)}
                        </p>
                        {nextShift.facility_units?.name && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            {nextShift.facility_units.name}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={nextShift.status} />
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div className="space-y-3 text-center py-4">
                    <p className="text-sm text-muted-foreground">
                      No upcoming shifts published yet. Check back once your manager publishes the schedule.
                    </p>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/me/schedule">Open schedule</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Quick Links
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/me/floor" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">Floor documentation</span>
                <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/shift" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">My Shift</span>
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/trainings" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">Training Records</span>
                <GraduationCap className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/schedule" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">My Schedule</span>
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/services" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">My Resident Services</span>
                <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/residents" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">Resident Chart</span>
                <HeartPulse className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/courses" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">My Training</span>
                <BookOpen className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/certificates" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">My Certificates</span>
                <FileCheck className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/documents" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">My Documents</span>
                <Files className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/credentials" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">My Credentials</span>
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/attestations" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">My Attestations</span>
                <FileSignature className="h-4 w-4 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                Competency Evaluations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {employeeLoading || competencyLoading ? (
                <div className="space-y-2">
                  {[...Array(2)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
                </div>
              ) : competencyError ? (
                <QueryError what="competency evaluations" error={competencyErrorDetail} onRetry={() => void refetchCompetency()} />
              ) : recentCompetencyRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No competency evaluations on file yet.</p>
              ) : (
                <div className="space-y-2">
                  {recentCompetencyRecords.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                      <div>
                        <span className="font-medium">
                          {competencyTemplateNameById.get(r.template_id) ?? `Template #${r.template_id.slice(0, 8)}`}
                        </span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Evaluated {formatDateForDisplay(r.evaluation_date)}
                          {r.signed_at ? " · Signed" : " · Not signed"}
                        </p>
                      </div>
                      <Badge variant={competencyResultVariant(r.overall_result)}>
                        {r.overall_result.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>All Training Records</CardTitle>
              <Link href="/me/trainings">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground -mr-2">
                  View All <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {recordsError ? (
                <QueryError what="your training records" error={recordsErrorDetail} onRetry={() => refetchRecords()} />
              ) : isLoading ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
                </div>
              ) : allRecords.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-6">No training records found.</p>
              ) : (
                <div className="space-y-2">
                  {recentRecords.map(r => (
                    <div key={r.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0 text-sm">
                      <span className="font-medium min-w-0 truncate">{trainingTypeName(r)}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {r.completion_date && (
                          <span className="text-muted-foreground text-xs">
                            Completed {formatDateForDisplay(r.completion_date)}
                          </span>
                        )}
                        {r.due_date && r.status !== "compliant" && (
                          <span className="text-muted-foreground text-xs">
                            Due {formatDateForDisplay(r.due_date)}
                          </span>
                        )}
                        <StatusBadge status={r.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
