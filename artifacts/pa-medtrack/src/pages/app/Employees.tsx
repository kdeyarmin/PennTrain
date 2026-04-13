import { useState } from "react";
import { useListEmployees, useListFacilities } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Users, Search, ChevronLeft, ChevronRight, UserPlus } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  jobTitle?: string | null;
  department?: string | null;
  status: string;
  facilityId?: number | null;
  administersMedications?: boolean;
  trainerStatus?: boolean;
  hireDate?: string | null;
};

const PAGE_SIZE = 15;
type SortField = "lastName" | "status" | "hireDate" | "jobTitle";

export default function Employees() {
  const [search, setSearch] = useState("");
  const [facilityId, setFacilityId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("lastName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const { user } = useAuth();

  const { data: employees, isLoading } = useListEmployees({
    facilityId: facilityId && facilityId !== "all" ? Number(facilityId) : undefined,
    status: status && status !== "all" ? status as "active" | "inactive" | "terminated" | "on_leave" : undefined,
  });
  const { data: facilities } = useListFacilities({});

  const allEmployees = (employees as Employee[] | undefined) ?? [];

  const filtered = allEmployees.filter(e => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      e.firstName.toLowerCase().includes(s) ||
      e.lastName.toLowerCase().includes(s) ||
      (e.jobTitle ?? "").toLowerCase().includes(s) ||
      (e.department ?? "").toLowerCase().includes(s)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "lastName") {
      cmp = `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    } else if (sortField === "status") {
      cmp = a.status.localeCompare(b.status);
    } else if (sortField === "jobTitle") {
      cmp = (a.jobTitle ?? "").localeCompare(b.jobTitle ?? "");
    } else if (sortField === "hireDate") {
      cmp = (a.hireDate ?? "").localeCompare(b.hireDate ?? "");
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
    setPage(1);
  }

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-muted-foreground">Manage staff and track their compliance status.</p>
        </div>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" /> Add Employee
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
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={facilityId} onValueChange={v => { setFacilityId(v); setPage(1); }}>
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
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
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
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
            </div>
          ) : paginated.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No employees found.</p>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("lastName")}>
                        Name{sortIndicator("lastName")}
                      </th>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("jobTitle")}>
                        Role{sortIndicator("jobTitle")}
                      </th>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("status")}>
                        Status{sortIndicator("status")}
                      </th>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("hireDate")}>
                        Hire Date{sortIndicator("hireDate")}
                      </th>
                      <th className="text-left p-3">Tags</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(emp => (
                      <tr key={emp.id} className="border-t hover:bg-muted/30">
                        <td className="p-3">
                          <Link href={`/employees/${emp.id}`}>
                            <span className="font-medium hover:underline cursor-pointer">
                              {emp.lastName}, {emp.firstName}
                            </span>
                          </Link>
                        </td>
                        <td className="p-3 text-muted-foreground">{emp.jobTitle ?? "—"}</td>
                        <td className="p-3">
                          <StatusBadge status={emp.status} type="employee" />
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {emp.hireDate ? new Date(emp.hireDate).toLocaleDateString() : "—"}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            {emp.administersMedications && <Badge variant="secondary" className="text-xs">Med Admin</Badge>}
                            {emp.trainerStatus && <Badge variant="outline" className="text-xs">Trainer</Badge>}
                          </div>
                        </td>
                        <td className="p-3">
                          <Link href={`/employees/${emp.id}`}>
                            <ChevronRight className="h-4 w-4 text-muted-foreground cursor-pointer" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length} employees
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        <span>{filtered.length} employee{filtered.length !== 1 ? "s" : ""} total</span>
      </div>
    </div>
  );
}
