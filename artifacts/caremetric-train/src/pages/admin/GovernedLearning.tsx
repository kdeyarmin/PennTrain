import { useState } from "react";
import { BookCheck, GitBranch, PackageCheck, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import { useGovernedLearning, useGovernedLearningCommand } from "@/hooks/useGovernedLearning";
import { useToast } from "@/hooks/use-toast";
import type { EnterpriseRecord } from "@/hooks/useEnterpriseFoundation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  const command = useGovernedLearningCommand(); const { toast } = useToast();
  const [revisionId, setRevisionId] = useState(""); const [decision, setDecision] = useState("approve"); const [reason, setReason] = useState("");
  const submit = async () => { try { await command.mutateAsync({ rpc: "review_governed_content_revision", args: { p_revision_id: revisionId, p_decision: decision, p_reason: reason } }); toast({ title: "Independent review recorded" }); setReason(""); } catch (error) { toast({ title: "Review blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" }); } };
  return <Card><CardHeader><CardTitle>Independent content review</CardTitle><CardDescription>Authors cannot approve their own protected publication. Validation and exact snapshot hashes remain attached.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div className="space-y-2 md:col-span-2"><Label htmlFor="p4-revision">Revision ID</Label><Input id="p4-revision" value={revisionId} onChange={(e) => setRevisionId(e.target.value)} /></div><div className="space-y-2"><Label>Decision</Label><Select value={decision} onValueChange={setDecision}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approve">Approve</SelectItem><SelectItem value="request_changes">Request changes</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="p4-reason">Reason</Label><Textarea id="p4-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div><div className="md:col-span-2"><Button onClick={() => void submit()} disabled={!revisionId || reason.trim().length < 5 || command.isPending}>Record review</Button></div></CardContent></Card>;
}

export default function GovernedLearning() {
  const snapshot = useGovernedLearning();
  if (snapshot.isLoading) return <div className="flex min-h-[45vh] items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin" /></div>;
  if (!snapshot.data) return <Alert variant="destructive"><AlertTitle>Governed learning unavailable</AlertTitle><AlertDescription>{snapshot.error instanceof Error ? snapshot.error.message : "Unable to load control plane."}</AlertDescription></Alert>;
  const data = snapshot.data;
  return <div className="space-y-6 p-4 md:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Governed learning and content</h1><p className="text-muted-foreground">Independent publication, standards interoperability, adaptive paths, and safe offline learning.</p></div><Button variant="outline" onClick={() => void snapshot.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div><Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Stable versions are the authority</AlertTitle><AlertDescription>Published snapshots are immutable. Standards commits, path transitions, and offline sync outcomes are replay-safe evidence.</AlertDescription></Alert><div className="grid gap-4 xl:grid-cols-3"><Metrics title="Content governance" description="Draft through immutable publication." values={data.content} /><Metrics title="Standards runtime" description="SCORM, xAPI, and selected LTI 1.3 capability." values={data.standards} /><Metrics title="Offline safety" description="Encrypted learner devices and visible sync outcomes." values={data.offline} /></div><Tabs defaultValue="review"><TabsList className="h-auto flex-wrap justify-start"><TabsTrigger value="review"><BookCheck className="mr-2 h-4 w-4" />Review</TabsTrigger><TabsTrigger value="policies"><ShieldCheck className="mr-2 h-4 w-4" />Policies</TabsTrigger><TabsTrigger value="standards"><PackageCheck className="mr-2 h-4 w-4" />Standards</TabsTrigger><TabsTrigger value="adaptive"><GitBranch className="mr-2 h-4 w-4" />Adaptive</TabsTrigger><TabsTrigger value="offline"><WifiOff className="mr-2 h-4 w-4" />Offline</TabsTrigger></TabsList><TabsContent value="review" className="mt-4"><ReviewCommand /></TabsContent><TabsContent value="policies" className="mt-4"><Metrics title="Policy lifecycle" description="Effective audiences, exact attestations, and delivery outcomes." values={data.policies} /></TabsContent><TabsContent value="standards" className="mt-4"><Metrics title="Interoperability" description="Only validated packages launch; unsupported capabilities stay online-only." values={data.standards} /></TabsContent><TabsContent value="adaptive" className="mt-4"><Metrics title="Adaptive paths" description="Pinned definitions and explainable server-side transitions." values={data.adaptive} /></TabsContent><TabsContent value="offline" className="mt-4"><Metrics title="Offline sync" description="Conflict, rejection, revocation, and wipe visibility." values={data.offline} /></TabsContent></Tabs>{data.generatedAt ? <p className="text-xs text-muted-foreground">Snapshot generated {new Date(data.generatedAt).toLocaleString()}</p> : null}</div>;
}
