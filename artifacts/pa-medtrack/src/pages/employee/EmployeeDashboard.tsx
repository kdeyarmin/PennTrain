import { useAuth } from "@/lib/auth";
import { useListTrainingRecords, useListPracticums } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, CheckCircle, Clock, AlertTriangle, FileText } from "lucide-react";
import { Link } from "wouter";

export default function EmployeeDashboard() {
  const { user } = useAuth();

  const { data: records, isLoading: recordsLoading } = useListTrainingRecords({});
  const { data: practicums, isLoading: practicumsLoading } = useListPracticums({
    year: new Date().getFullYear(),
  });

  type TrainingRecord = {
    id: number;
    status: string;
    dueDate?: string | null;
    trainingTypeName?: string | null;
    completionDate?: string | null;
  };

  const allRecords = (records as TrainingRecord[] | undefined) ?? [];
  const compliant = allRecords.filter(r => r.status === "compliant").length;
  const expired = allRecords.filter(r => r.status === "expired").length;
  const dueSoon = allRecords.filter(r => r.status === "due_soon").length;

  const myPracticum = practicums?.find(p => p.status !== undefined);
  const upcomingRecords = allRecords
    .filter(r => r.status === "due_soon" || r.status === "expired")
    .sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-2xl font-bold">{recordsLoading ? "—" : compliant}</p>
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
                <p className="text-2xl font-bold">{recordsLoading ? "—" : dueSoon}</p>
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
                <p className="text-2xl font-bold">{recordsLoading ? "—" : expired}</p>
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
              Annual Practicum ({new Date().getFullYear()})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {practicumsLoading ? (
              <div className="h-16 bg-muted animate-pulse rounded" />
            ) : myPracticum ? (
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <p className="font-medium text-sm">Medication Administration Practicum</p>
                  {myPracticum.completionDate && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Completed: {new Date(myPracticum.completionDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <Badge variant={myPracticum.status === "compliant" ? "default" : "secondary"}>
                  {myPracticum.status}
                </Badge>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No practicum record for {new Date().getFullYear()}.</p>
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
                  <span className="font-medium">{r.trainingTypeName ?? `Training #${r.id}`}</span>
                  <div className="flex items-center gap-2">
                    {r.dueDate && (
                      <span className="text-muted-foreground text-xs">
                        Due {new Date(r.dueDate).toLocaleDateString()}
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
          {recordsLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : allRecords.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">No training records found.</p>
          ) : (
            <div className="space-y-2">
              {allRecords.map(r => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                  <span className="font-medium">{r.trainingTypeName ?? `Training #${r.id}`}</span>
                  <div className="flex items-center gap-2">
                    {r.completionDate && (
                      <span className="text-muted-foreground text-xs">
                        Completed {new Date(r.completionDate).toLocaleDateString()}
                      </span>
                    )}
                    {r.dueDate && r.status !== "compliant" && (
                      <span className="text-muted-foreground text-xs">
                        Due {new Date(r.dueDate).toLocaleDateString()}
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
    </div>
  );
}
