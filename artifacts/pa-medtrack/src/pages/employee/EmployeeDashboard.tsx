import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, CheckCircle, Clock, AlertTriangle, FileText } from "lucide-react";
import { Link } from "wouter";

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

  const typeNameById = new Map((trainingTypes ?? []).map(t => [t.id, t.name]));
  const trainingTypeName = (r: TrainingRecord) => typeNameById.get(r.training_type_id) ?? `Training #${r.id.slice(0, 8)}`;

  const isLoading = employeeLoading || recordsLoading;

  const allRecords = records ?? [];
  const compliant = allRecords.filter(r => r.status === "compliant").length;
  const expired = allRecords.filter(r => r.status === "expired").length;
  const dueSoon = allRecords.filter(r => r.status === "due_soon").length;

  const myPracticum = practicums?.[0];
  const upcomingRecords = allRecords
    .filter(r => r.status === "due_soon" || r.status === "expired")
    .sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    })
    .slice(0, 5);

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

          {upcomingRecords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Attention Required</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {upcomingRecords.map(r => (
                    <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                      <span className="font-medium">{trainingTypeName(r)}</span>
                      <div className="flex items-center gap-2">
                        {r.due_date && (
                          <span className="text-muted-foreground text-xs">
                            Due {new Date(r.due_date).toLocaleDateString()}
                          </span>
                        )}
                        <Badge variant={r.status === "expired" ? "destructive" : "secondary"}>
                          {r.status === "due_soon" ? "Due Soon" : r.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

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
                    <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                      <span className="font-medium">{trainingTypeName(r)}</span>
                      <div className="flex items-center gap-2">
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
