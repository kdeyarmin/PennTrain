import { useListOrganizations } from "@/hooks/useOrganizations";
import { useGetPlatformHealth } from "@/hooks/usePlatformHealth";
import { useListSupportTickets } from "@/hooks/useSupportTickets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Building2, Users, AlertCircle, CheckCircle, TrendingUp, ChevronRight, Send, Sparkles, Video, Ban, LifeBuoy } from "lucide-react";
import { Link } from "wouter";

export default function AdminDashboard() {
  const { data: orgs, isLoading } = useListOrganizations();
  const { data: health, isLoading: healthLoading } = useGetPlatformHealth();
  const { data: openTickets } = useListSupportTickets({ status: "open" });

  const totalOrgs = orgs?.length ?? 0;
  const activeOrgs = orgs?.filter(o => o.subscription_status === "active").length ?? 0;
  const trialOrgs = orgs?.filter(o => o.subscription_status === "trial").length ?? 0;

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
                <p className="text-2xl font-bold">{orgs?.filter(o => o.subscription_status === "past_due").length ?? 0}</p>
                <p className="text-sm text-muted-foreground">Past Due</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Link href="/admin/notifications?status=failed" className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <div className="h-9 w-9 rounded-md bg-red-100 flex items-center justify-center shrink-0">
                  <Send className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.notificationDeliveriesFailed ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Failed Deliveries</p>
                </div>
              </Link>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="h-9 w-9 rounded-md bg-amber-100 flex items-center justify-center shrink-0">
                  <Send className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.notificationDeliveriesPending ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Pending Deliveries</p>
                </div>
              </div>
              <Link href="/admin/ai-generations" className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <div className="h-9 w-9 rounded-md bg-red-100 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.aiGenerationsFailed ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Failed AI Generations (30d)</p>
                </div>
              </Link>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="h-9 w-9 rounded-md bg-blue-100 flex items-center justify-center shrink-0">
                  <Video className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.heygenJobsInProgress ?? 0}</p>
                  <p className="text-xs text-muted-foreground">HeyGen Jobs In Progress</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="h-9 w-9 rounded-md bg-orange-100 flex items-center justify-center shrink-0">
                  <Ban className="h-4 w-4 text-orange-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.orgsByStatus?.suspended ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Suspended Orgs</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="h-9 w-9 rounded-md bg-green-100 flex items-center justify-center shrink-0">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{health?.totalEmployees ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Total Employees</p>
                </div>
              </div>
              <Link href="/admin/support-tickets?status=open" className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <div className="h-9 w-9 rounded-md bg-amber-100 flex items-center justify-center shrink-0">
                  <LifeBuoy className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{openTickets?.length ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Open Support Tickets</p>
                </div>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

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
                        <p className="text-xs text-muted-foreground">{org.plan_name ?? "Standard"} plan</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={org.subscription_status ?? "active"} type="subscription" />
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
