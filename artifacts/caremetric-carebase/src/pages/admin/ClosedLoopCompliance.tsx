import { Link } from "wouter";
import { ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useClosedLoopCompliance } from "@/hooks/useClosedLoopCompliance";
import type { EnterpriseRecord } from "@/hooks/useEnterpriseFoundation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const label = (value: string) =>
  value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, character => character.toUpperCase());

function Metrics({
  title,
  description,
  values,
  href,
}: {
  title: string;
  description: string;
  values: EnterpriseRecord;
  href?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {href && (
            <Button asChild size="sm" variant="outline">
              <Link href={href}>Open <ArrowRight className="ml-1 h-4 w-4" /></Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{label(key)}</p>
            <p className="mt-1 text-2xl font-semibold">{String(value ?? "—")}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function ClosedLoopCompliance() {
  const query = useClosedLoopCompliance();
  const { user } = useAuth();
  if (query.isLoading) {
    return <div className="flex min-h-[45vh] items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin" /></div>;
  }
  if (!query.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Control plane unavailable</AlertTitle>
        <AlertDescription>{query.error instanceof Error ? query.error.message : "Unable to load."}</AlertDescription>
      </Alert>
    );
  }
  const data = query.data;
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Closed-loop compliance and evidence</h1>
          <p className="text-muted-foreground">Owned remediation, confidential intake, move-in readiness, reproducible reports, and external evidence access.</p>
        </div>
        <Button variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Snapshots, not unrestricted live access</AlertTitle>
        <AlertDescription>External guests receive selected immutable artifacts. Every authorization and denial is attributable, expiring, and revocable.</AlertDescription>
      </Alert>
      <div className="grid gap-4 xl:grid-cols-3">
        <Metrics title="Owned work" description="Deadline-driven remediation and escalation." values={data.work} href="/app/work" />
        <Metrics title="Confidential intake" description="Restricted triage and investigation queues." values={data.incidents} href={user?.role === "platform_admin" ? undefined : "/app/confidential-incidents"} />
        <Metrics title="Documentation room" description="Published collections and external access." values={data.evidenceRoom} href="/app/evidence" />
      </div>
      <Tabs defaultValue="moveins">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="moveins">Move-ins</TabsTrigger>
          <TabsTrigger value="reports">Historical reports</TabsTrigger>
          <TabsTrigger value="evidence">Documentation room</TabsTrigger>
        </TabsList>
        <TabsContent value="moveins" className="mt-4">
          <Metrics title="Move-in readiness" description="Owned tasks, dependencies, signatures, approvals, and guest scope." values={data.moveIns} />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <Metrics title="Reproducible reporting" description="Versioned definitions, schedules, as-of snapshots, and reconciliation." values={data.reports} />
        </TabsContent>
        <TabsContent value="evidence" className="mt-4">
          <Metrics title="External evidence access" description="Non-enumerable grants, expiration, revocation, legal hold, and access audit." values={data.evidenceRoom} />
        </TabsContent>
      </Tabs>
      {data.generatedAt ? <p className="text-xs text-muted-foreground">Snapshot generated {new Date(data.generatedAt).toLocaleString()}</p> : null}
    </div>
  );
}
