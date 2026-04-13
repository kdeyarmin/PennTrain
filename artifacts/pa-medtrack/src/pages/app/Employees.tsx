import { useState } from "react";
import { useListEmployees, useListFacilities } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Users, Search, ChevronRight, Filter } from "lucide-react";
import { Link } from "wouter";

export default function Employees() {
  const [search, setSearch] = useState("");
  const [facilityId, setFacilityId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");

  const { data: employees, isLoading } = useListEmployees({
    search: search || undefined,
    facilityId: facilityId && facilityId !== "all" ? Number(facilityId) : undefined,
    status: status && status !== "all" ? status as "active" | "inactive" | "terminated" | "on_leave" : undefined,
  });

  const { data: facilities } = useListFacilities({});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-muted-foreground">Manage staff and track their compliance status.</p>
        </div>
        <Button>
          <Users className="mr-2 h-4 w-4" /> Add Employee
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search employees..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={facilityId} onValueChange={setFacilityId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Facilities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Facilities</SelectItem>
                {facilities?.map(f => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
                <SelectItem value="on_leave">On Leave</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {employees?.map(emp => (
                <Link key={emp.id} href={`/app/employees/${emp.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 border transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-semibold text-primary">
                          {emp.firstName[0]}{emp.lastName[0]}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-sm">{emp.firstName} {emp.lastName}</p>
                        <p className="text-xs text-muted-foreground">{emp.jobTitle}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {emp.administersMedications && (
                        <Badge variant="secondary" className="text-xs">Med Admin</Badge>
                      )}
                      {emp.trainerStatus && (
                        <Badge variant="outline" className="text-xs">Trainer</Badge>
                      )}
                      <StatusBadge status={emp.status} type="employee" />
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
              {(!employees || employees.length === 0) && (
                <p className="text-center text-muted-foreground py-8">No employees found.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
