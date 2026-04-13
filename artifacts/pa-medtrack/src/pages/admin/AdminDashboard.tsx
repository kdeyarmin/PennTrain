import { useListOrganizations, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Building2, Users, AlertCircle, CheckCircle, TrendingUp, ChevronRight } from "lucide-react";
import { Link } from "wouter";

export default function AdminDashboard() {
  const { data: orgs, isLoading } = useListOrganizations({});
  const { data: me } = useGetMe({});

  const totalOrgs = orgs?.length ?? 0;
  const activeOrgs = orgs?.filter(o => o.subscriptionStatus === "active").length ?? 0;
  const trialOrgs = orgs?.filter(o => o.subscriptionStatus === "trial").length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Platform Dashboard</h1>
        <p className="text-muted-foreground">Overview of all organizations and system health.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalOrgs}</p>
                <p className="text-sm text-muted-foreground">Total Organizations</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeOrgs}</p>
                <p className="text-sm text-muted-foreground">Active Subscriptions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{trialOrgs}</p>
                <p className="text-sm text-muted-foreground">Trial Accounts</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{orgs?.filter(o => o.subscriptionStatus === "past_due").length ?? 0}</p>
                <p className="text-sm text-muted-foreground">Past Due</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

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
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {orgs?.map(org => (
                <Link key={org.id} href={`/admin/organizations/${org.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer border">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{org.name}</p>
                        <p className="text-xs text-muted-foreground">{org.planName ?? "Standard"} plan</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={org.subscriptionStatus ?? "active"} type="subscription" />
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
              {(!orgs || orgs.length === 0) && (
                <p className="text-muted-foreground text-sm text-center py-4">No organizations found.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
