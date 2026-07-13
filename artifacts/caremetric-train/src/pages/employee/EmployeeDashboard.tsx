import { useAuth } from "@/lib/auth";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
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
import {
  GraduationCap, CheckCircle, Clock, AlertTriangle, FileText, ClipboardCheck, BookOpen,
  CalendarClock, CalendarDays, MapPin, FileCheck2, FileCheck, Files, ShieldCheck, FileSignature,
  ChevronRight, type LucideIcon,
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
  const currentYear = new Date().getFullYear();

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
  const { data: competencyRecords, isLoading: competencyLoading } = useListCompetencyRecords(
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
  const { data: shifts, isLoading: shiftsLoading } = useListShiftAssignments(
    { employeeId: employee?.id, fromDate: todayIso() },
    { enabled: !!employee?.id },
  );
  const nextShift = shifts?.[0];

  const typeNameById = new Map((trainingTypes ?? []).map(t => [t.id, t.name]));
  const trainingTypeName = (r: TrainingRecord) => typeNameById.get(r.training_type_id) ?? `Training #${r.id.slice(0, 8)}`;

  const isLoading = employeeLoading || recordsLoading;

  const allRecords = records ?? [];
  const compliant = allRecords.filter(r => r.status === "compliant").length;
  const expired = allRecords.filter(r => r.status === "expired").length;
  const dueSoon = allRecords.filter(r => r.status === "due_soon").length;
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
    }));
  const practicumDeadlines: DeadlineItem[] =
    myPracticum && myPracticum.due_date && myPracticum.status !== "compliant"
      ? [{
          id: `practicum-${myPracticum.id}`,
          kind: "practicum",
          label: "Medication Administration Practicum",
          dueDate: myPracticum.due_date,
          status: myPracticum.status,
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
        <h1 className="text-2xl font-bold tracking-tight">My Training</h1>
        <p className="text-muted-foreground">
          Welcome, {user?.firstName}. View your training records and compliance status.
        </p>
      </div>

      {!employeeLoading && !employee ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground text-center">
              No employee profile is linked to this account yet. Contact your facility manager.
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
                    <p className="text-2xl font-bold">{isLoading ? "—" : compliant}</p>
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
                    <p className="text-2xl font-bold">{isLoading ? "—" : dueSoon}</p>
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
                    <p className="text-2xl font-bold">{isLoading ? "—" : expired}</p>
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
                    <p className="text-2xl font-bold">{employeeLoading || attestationsLoading ? "—" : pendingAttestations.length}</p>
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
                ) : nextShift ? (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-lg border">
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
                    <StatusBadge status={nextShift.status} className="shrink-0" />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No upcoming shifts published yet. Check back once your manager publishes the schedule.
                  </p>
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
              <Link href="/me/trainings" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">Training Records</span>
                <GraduationCap className="h-4 w-4 text-muted-foreground" />
              </Link>
              <Link href="/me/schedule" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                <span className="font-medium text-sm">My Schedule</span>
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
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
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5" />
                Upcoming Deadlines
              </CardTitle>
            </CardHeader>
            <CardContent>
              {deadlineSourcesError ? (
                <QueryError what="your upcoming deadlines" onRetry={retryDeadlineSources} />
              ) : assignmentsLoading || practicumsLoading || attestationsLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
                </div>
              ) : upcomingDeadlines.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nothing due right now -- you're all caught up.</p>
              ) : (
                <div className="space-y-2">
                  {upcomingDeadlines.map((d) => {
                    const meta = DEADLINE_KIND_META[d.kind];
                    const Icon = meta.icon;
                    const row = (
                      <div className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                        <span className="flex items-center gap-2 min-w-0">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate">{d.label}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">{meta.label}</Badge>
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-muted-foreground text-xs">
                            Due {formatDateForDisplay(d.dueDate)}
                          </span>
                          <StatusBadge status={d.status} />
                        </div>
                      </div>
                    );
                    return d.href ? (
                      <Link key={d.id} href={d.href} className="block hover:bg-muted/30 -mx-2 px-2 rounded">
                        {row}
                      </Link>
                    ) : (
                      <div key={d.id}>{row}</div>
                    );
                  })}
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
