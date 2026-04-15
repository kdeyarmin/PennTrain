import { useListUsers, type User } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Plus, Shield } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  platform_admin: "Platform Admin",
  org_admin: "Org Admin",
  facility_manager: "Facility Manager",
  trainer: "Trainer",
  employee: "Employee",
};

export default function Users() {
  const { data: usersData, isLoading } = useListUsers({});
  const users: User[] = usersData ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted-foreground">Manage user accounts and access levels.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add User
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-semibold text-primary">
                        {user.firstName?.[0]}{user.lastName?.[0]}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-sm">{user.firstName} {user.lastName}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      <Shield className="h-3 w-3 mr-1" />
                      {ROLE_LABELS[user.role] ?? user.role}
                    </Badge>
                    <StatusBadge status={user.isActive ? "active" : "inactive"} type="employee" />
                  </div>
                </div>
              ))}
              {users.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No users found.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
