import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useListCompetencyRecords, useListCompetencyTemplates } from "@/hooks/useCompetencies";
import { useListCourseAssignments } from "@/hooks/useCourseAssignments";
import { useListCourses } from "@/hooks/useCourses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, CheckCircle, Clock, AlertTriangle, FileText, ClipboardCheck, BookOpen, CalendarClock, type LucideIcon } from "lucide-react";
import { Link } from "wouter";

interface DeadlineItem {
  id: string;
  kind: "course" | "training" | "practicum";
  label: string;
  dueDate: string;
  status: string;
  href?: string;
}

const DEADLINE_KIND_META: Record<DeadlineItem["kind"], { label: string; icon: LucideIcon }> = {
  course: { label: "Course", icon: BookOpen },
  training: { label: "Training", icon: GraduationCap },
  practicum: { label: "Practicum", icon: ClipboardCheck },
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
  const { data: records, isLoading: recordsLoading } = useListTrainingRecords({ employeeId: employee?.id });
  const { data: practicums, isLoading: practicumsLoading } = useListPracticums({
    employeeId: employee?.id,
    year: currentYear,
  });
  const { data: trainingTypes } = useListTrainingTypes();
  const { data: courseAssignments, isLoading: assignmentsLoading } = useListCourseAssignments({ employeeId: employee?.id });
  const { data: courses } = useListCourses();
  const courseTitleById = new Map((courses ?? []).map(c => [c.id, c.title]));

  // Competency records are trainer-authored/signed -- RLS gives an employee
  // read-only access to their own rows only (owns_employee() appears in the
  // SELECT policy but not insert/update), so this dashboard only ever reads
  // them here. There is no create/edit UI for competency records anywhere in
  // the employee-facing pages.
  const { data: competencyRecords, isLoading: competencyLoading } = useListCompetencyRecords({ employeeId: employee?.id });
  const { data: competencyTemplates } = useListCompetencyTemplates();
  const competencyTemplateNameById = new Map((competencyTemplates ?? []).map((t) => [t.id, t.name]));
  const recentCompetencyRecords = [...(competencyRecords ?? [])]
    .sort((a, b) => b.evaluation_date.localeCompare(a.evaluation_date))
    .slice(0, 5);

  const typeNameById = new Map((trainingTypes ?? []).map(t => [t.id, t.name]));
  const trainingTypeName = (r: TrainingRecord) => typeNameById.get(r.training_type_id) ?? `Training #${r.id.slice(0, 8)}`;

  const isLoading = employeeLoading || recordsLoading;

  const allRecords = records ?? [];
  const compliant = allRecords.filter(r => r.status === "compliant").length;
  const expired = allRecords.filter(r => r.status === "expired").length;
  const dueSoon = allRecords.filter(r => r.status === "due_soon").length;

  const myPracticum = practicums?.[0];

  // A single, sorted "what's next" list across the three deadline sources
  // that otherwise live in unrelated tables (course_assignments,
  // employee_training_records, practicums) -- previously each only surfaced
  // its own status in its own card, so a learner had to check three places
  // to see everything coming due.
  const courseDeadlines: DeadlineItem[] = (courseAssignments ?? [])
    .filter(a => a.due_date && a.status !== "completed")
    .map(a => ({
      id: `course-${a.id}`,
      kind: "course",
      label: courseTitleById.get(a.course_id) ?? "Course",
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
  const upcomingDeadlines = [...courseDeadlines, ...trainingDeadlines, ...practicumDeadlines]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 8);

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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
                          Completed: {new Date(myPracticum.completion_date).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <Badge variant={myPracticum.status === "compliant" ? "default" : "secondary"}>
                      {myPracticum.status}
                    </Badge>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No practicum record for {currentYear}.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Quick Links
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link href="/me/trainings" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                  <span className="font-medium text-sm">View All Training Records</span>
                  <GraduationCap className="h-4 w-4 text-muted-foreground" />
                </Link>
                <Link href="/me/documents" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                  <span className="font-medium text-sm">My Documents</span>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </Link>
              </CardContent>
            </Card>
          </div>

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
                          Evaluated {new Date(r.evaluation_date).toLocaleDateString()}
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
              {assignmentsLoading || practicumsLoading ? (
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
                    const variant = d.status === "expired" || d.status === "overdue" || d.status === "missing" ? "destructive" : "secondary";
                    const row = (
                      <div className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                        <span className="flex items-center gap-2 min-w-0">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate">{d.label}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">{meta.label}</Badge>
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-muted-foreground text-xs">
                            Due {new Date(d.dueDate).toLocaleDateString()}
                          </span>
                          <Badge variant={variant}>{d.status.replace(/_/g, " ")}</Badge>
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
            <CardHeader>
              <CardTitle>All Training Records</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
                </div>
              ) : allRecords.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-6">No training records found.</p>
              ) : (
                <div className="space-y-2">
                  {allRecords.map(r => (
                    <div key={r.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0 text-sm">
                      <span className="font-medium min-w-0 truncate">{trainingTypeName(r)}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {r.completion_date && (
                          <span className="text-muted-foreground text-xs">
                            Completed {new Date(r.completion_date).toLocaleDateString()}
                          </span>
                        )}
                        {r.due_date && r.status !== "compliant" && (
                          <span className="text-muted-foreground text-xs">
                            Due {new Date(r.due_date).toLocaleDateString()}
                          </span>
                        )}
                        <Badge variant={r.status === "compliant" ? "default" : r.status === "expired" ? "destructive" : "secondary"}>
                          {r.status}
                        </Badge>
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
