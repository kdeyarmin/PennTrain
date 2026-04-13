import { useAuth } from "@/lib/auth";
import { useListEmployees, useListFacilities, useListTrainingRecords, useListPracticums } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Users, CheckCircle, Clock, Building2 } from "lucide-react";
import { Link } from "wouter";

export default function TrainerDashboard() {
  const { user } = useAuth();

  const { data: facilities } = useListFacilities({});
  const { data: employees } = useListEmployees({ administersMedications: true });
  const { data: records } = useListTrainingRecords({});
  const { data: practicums, isLoading: practicumsLoading } = useListPracticums({
    year: new Date().getFullYear(),
  });

  const totalMedAdmin = employees?.length ?? 0;
  const totalFacilities = facilities?.length ?? 0;
  const compliant = practicums?.filter(p => p.status === "compliant").length ?? 0;
  const pending = practicums?.filter(p => p.status !== "compliant").length ?? 0;

  const recentRecords = (records as { id: number; employeeId: number; status: string; dueDate?: string | null; trainingTypeName?: string | null }[] | undefined)?.slice(0, 5) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Trainer Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome, {user?.firstName}. Manage training sessions and track certifications.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Building2 className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{totalFacilities}</p>
                <p className="text-sm text-muted-foreground">Assigned Facilities</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-2xl font-bold">{totalMedAdmin}</p>
                <p className="text-sm text-muted-foreground">Med Admin Staff</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-2xl font-bold">{practicumsLoading ? "—" : compliant}</p>
                <p className="text-sm text-muted-foreground">Practicums Compliant</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-yellow-600" />
              <div>
                <p className="text-2xl font-bold">{practicumsLoading ? "—" : pending}</p>
                <p className="text-sm text-muted-foreground">Practicums Pending</p>
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
              Quick Links
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/trainer/employees" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
              <span className="font-medium text-sm">View Med Admin Employees</span>
              <Users className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link href="/trainer/facilities" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
              <span className="font-medium text-sm">View Assigned Facilities</span>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Annual Practicum Status ({new Date().getFullYear()})</CardTitle>
          </CardHeader>
          <CardContent>
            {practicumsLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
              </div>
            ) : !practicums?.length ? (
              <p className="text-muted-foreground text-sm text-center py-4">No practicum records for this year.</p>
            ) : (
              <div className="space-y-2">
                {practicums.slice(0, 5).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                    <span>Employee #{p.employeeId}</span>
                    <Badge variant={p.status === "compliant" ? "default" : "secondary"}>
                      {p.status}
                    </Badge>
                  </div>
                ))}
                {practicums.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">+{practicums.length - 5} more</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {recentRecords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Training Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentRecords.map(r => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                  <div>
                    <span className="font-medium">Employee #{r.employeeId}</span>
                    {r.trainingTypeName && <span className="text-muted-foreground ml-2">· {r.trainingTypeName}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.dueDate && <span className="text-muted-foreground text-xs">Due {new Date(r.dueDate).toLocaleDateString()}</span>}
                    <Badge variant={r.status === "compliant" ? "default" : r.status === "expired" ? "destructive" : "secondary"}>
                      {r.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
