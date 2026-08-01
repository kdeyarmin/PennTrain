import { useId, useState } from "react";
import { BookCheck, GitBranch, PackageCheck, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import { useGovernedLearning, useGovernedLearningCommand } from "@/hooks/useGovernedLearning";
import {
  useAcceptLearningPackage,
  useAdminLearningPackages,
  useQuarantineLearningPackage,
} from "@/hooks/useLearningRuntime";
import { useToast } from "@/hooks/use-toast";
import type { EnterpriseRecord } from "@/hooks/useEnterpriseFoundation";
import { QuarantinePackageDialog } from "@/components/learning/QuarantinePackageDialog";
import { QueryError } from "@/components/QueryState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());
function Metrics({ title, description, values }: { title: string; description: string; values: EnterpriseRecord }) {
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{Object.entries(values).map(([key, value]) => <div key={key} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label(key)}</p><p className="mt-1 text-2xl font-semibold">{String(value ?? "—")}</p></div>)}</CardContent></Card>;
}

function ReviewCommand() {
  const __fieldIds = useId();
  const command = useGovernedLearningCommand(); const { toast } = useToast();
  const [revisionId, setRevisionId] = useState(""); const [decision, setDecision] = useState("approve"); const [reason, setReason] = useState("");
  const submit = async () => { try { await command.mutateAsync({ rpc: "review_governed_content_revision", args: { p_revision_id: revisionId, p_decision: decision, p_reason: reason } }); toast({ title: "Independent review recorded" }); setReason(""); } catch (error) { toast({ title: "Review blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" }); } };
  return <Card><CardHeader><CardTitle>Independent content review</CardTitle><CardDescription>Authors cannot approve their own protected publication. Validation and exact snapshot hashes remain attached.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div className="space-y-2 md:col-span-2"><Label htmlFor="p4-revision">Revision ID</Label><Input id="p4-revision" value={revisionId} onChange={(e) => setRevisionId(e.target.value)} /></div><div className="space-y-2"><Label htmlFor={`${__fieldIds}-decision`}>Decision</Label><Select value={decision} onValueChange={setDecision}><SelectTrigger id={`${__fieldIds}-decision`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approve">Approve</SelectItem><SelectItem value="request_changes">Request changes</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="p4-reason">Reason</Label><Textarea id="p4-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div><div className="md:col-span-2"><Button onClick={() => void submit()} disabled={!revisionId || reason.trim().length < 5 || command.isPending}>Record review</Button></div></CardContent></Card>;
}

function StandardsPackagesPanel() {
  const packages = useAdminLearningPackages(null);
  const accept = useAcceptLearningPackage();
  const quarantine = useQuarantineLearningPackage();
  const { toast } = useToast();
  const rows = packages.data ?? [];
  const [quarantineTarget, setQuarantineTarget] = useState<{ id: string; path: string } | null>(null);

  return (
    <div className="space-y-4">
      <Metrics title="Interoperability" description="Only validated packages launch; unsupported capabilities stay online-only." values={(packages.isLoading ? {} : {
        acceptedPackages: rows.filter((r) => r.validation_status === "accepted").length,
        pendingPackages: rows.filter((r) => r.validation_status === "pending" || r.validation_status === "validating").length,
        quarantinedPackages: rows.filter((r) => r.validation_status === "quarantined" || r.validation_status === "rejected").length,
      }) as EnterpriseRecord} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Learning packages</CardTitle>
          <CardDescription>
            Register SCORM/xAPI packages from course authoring, then accept after structural review. Accepted packages are immutable and launchable by the standards runtime.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {packages.isError && (
            <QueryError what="learning packages" error={packages.error} onRetry={() => void packages.refetch()} />
          )}
          {packages.isLoading && <p className="text-sm text-muted-foreground">Loading packages…</p>}
          {!packages.isLoading && !packages.isError && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No packages registered yet. Upload a SCORM zip on a course block, then register/accept it here or via course authoring.</p>
          )}
          {rows.map((pkg) => (
            <div key={pkg.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{pkg.standard_type} · {pkg.entry_point ?? "no entry"}</p>
                <p className="text-xs text-muted-foreground truncate">{pkg.storage_path} · {pkg.content_sha256.slice(0, 12)}…</p>
                <p className="text-xs text-muted-foreground">Version {pkg.course_version_id.slice(0, 8)} · {new Date(pkg.created_at).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={pkg.validation_status === "accepted" ? "default" : pkg.validation_status === "quarantined" ? "destructive" : "secondary"}>
                  {pkg.validation_status}
                </Badge>
                {pkg.validation_status !== "accepted" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={accept.isPending}
                    onClick={async () => {
                      try {
                        await accept.mutateAsync({ packageId: pkg.id, reason: "Accepted after structural authoring review" });
                        toast({ title: "Package accepted" });
                      } catch (e) {
                        toast({ title: "Accept blocked", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
                      }
                    }}
                  >
                    Accept
                  </Button>
                )}
                {pkg.validation_status !== "quarantined" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={quarantine.isPending}
                    onClick={() => setQuarantineTarget({ id: pkg.id, path: pkg.storage_path })}
                  >
                    Quarantine
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <QuarantinePackageDialog
        open={quarantineTarget !== null}
        packagePath={quarantineTarget?.path}
        pending={quarantine.isPending}
        onOpenChange={(open) => {
          if (!open) setQuarantineTarget(null);
        }}
        onConfirm={async (reason) => {
          if (!quarantineTarget) return;
          try {
            await quarantine.mutateAsync({ packageId: quarantineTarget.id, reason });
            toast({ title: "Package quarantined" });
            setQuarantineTarget(null);
          } catch (e) {
            toast({ title: "Quarantine blocked", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
          }
        }}
      />
    </div>
  );
}

export default function GovernedLearning() {
  const snapshot = useGovernedLearning();
  if (snapshot.isLoading) return <div className="flex min-h-[45vh] items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin" /></div>;
  if (!snapshot.data) return <Alert variant="destructive"><AlertTitle>Governed content unavailable</AlertTitle><AlertDescription>{snapshot.error instanceof Error ? snapshot.error.message : "Unable to load control plane."}</AlertDescription></Alert>;
  const data = snapshot.data;
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Governed content and training</h1>
          <p className="text-muted-foreground">Independent publication, standards interoperability, adaptive paths, and safe offline training access.</p>
        </div>
        <Button variant="outline" onClick={() => void snapshot.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Stable versions are the authority</AlertTitle>
        <AlertDescription>Published snapshots are immutable. Standards commits, path transitions, and offline sync outcomes are replay-safe documentation.</AlertDescription>
      </Alert>
      <div className="grid gap-4 xl:grid-cols-3">
        <Metrics title="Content governance" description="Draft through immutable publication." values={data.content} />
        <Metrics title="Standards runtime" description="SCORM, xAPI, and selected LTI 1.3 capability." values={data.standards} />
        <Metrics title="Offline safety" description="Encrypted employee devices and visible sync outcomes." values={data.offline} />
      </div>
      <Tabs defaultValue="review">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="review"><BookCheck className="mr-2 h-4 w-4" />Review</TabsTrigger>
          <TabsTrigger value="policies"><ShieldCheck className="mr-2 h-4 w-4" />Policies</TabsTrigger>
          <TabsTrigger value="standards"><PackageCheck className="mr-2 h-4 w-4" />Standards</TabsTrigger>
          <TabsTrigger value="adaptive"><GitBranch className="mr-2 h-4 w-4" />Adaptive</TabsTrigger>
          <TabsTrigger value="offline"><WifiOff className="mr-2 h-4 w-4" />Offline</TabsTrigger>
        </TabsList>
        <TabsContent value="review" className="mt-4"><ReviewCommand /></TabsContent>
        <TabsContent value="policies" className="mt-4"><Metrics title="Policy lifecycle" description="Effective audiences, exact attestations, and delivery outcomes." values={data.policies} /></TabsContent>
        <TabsContent value="standards" className="mt-4"><StandardsPackagesPanel /></TabsContent>
        <TabsContent value="adaptive" className="mt-4"><Metrics title="Adaptive paths" description="Pinned definitions and explainable server-side transitions." values={data.adaptive} /></TabsContent>
        <TabsContent value="offline" className="mt-4"><Metrics title="Offline sync" description="Conflict, rejection, revocation, and wipe visibility." values={data.offline} /></TabsContent>
      </Tabs>
      {data.generatedAt ? <p className="text-xs text-muted-foreground">Snapshot generated {new Date(data.generatedAt).toLocaleString()}</p> : null}
    </div>
  );
}
