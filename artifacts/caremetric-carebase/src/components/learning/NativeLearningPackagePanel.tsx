import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUploadLearningPackage } from "@/hooks/useLearningPackageIngestion";
import { useAcceptLearningPackage, useAdminLearningPackages } from "@/hooks/useLearningRuntime";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/QueryState";

type Intent = { operationId: string; requestId: string; operation: "upload" | "accept"; packageId: string;
  sourceSha256: string; state: "prepared" | "staged" | "committed" | "expired"; canFinishThisSession: boolean };
type Context = { sourceRevision: string; intents: { items: Intent[]; hasMore: boolean } };
function AcceptPackage({ packageId, disabled }: { packageId: string; disabled: boolean }) {
  const [reason, setReason] = useState(""); const accept = useAcceptLearningPackage();
  return <div className="flex flex-wrap items-center gap-2">
    <Input aria-label="Package acceptance reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} disabled={disabled || accept.isPending} placeholder="Reason for accepting this reviewed package" />
    <Button disabled={disabled || accept.isPending || reason.trim().length < 8} onClick={() => accept.mutate({ packageId, reason: reason.trim() })}>Accept reviewed package</Button>
    {accept.isError && <p role="alert" className="text-sm text-destructive">{accept.error.message}</p>}
  </div>;
}
export function NativeLearningPackagePanel({ versionId, userId, disabled = false }: { versionId: string; userId: string; disabled?: boolean }) {
  const client = useQueryClient(); const upload = useUploadLearningPackage(); const packages = useAdminLearningPackages(versionId);
  const input = useRef<HTMLInputElement>(null); const [standard, setStandard] = useState<"scorm_1_2" | "scorm_2004_4th" | "xapi">("scorm_1_2");
  const context = useQuery({ queryKey: ["learning_package_context", userId, versionId], queryFn: async () => {
    const { data, error } = await supabase.rpc("get_native_learning_package_context", { p_version_id: versionId });
    if (error) throw new Error(error.message); return data as unknown as Context;
  } });
  const finish = useMutation({ mutationFn: async (operationId: string) => {
    const { error } = await supabase.rpc("finish_native_learning_package_operation", { p_operation_id: operationId });
    if (error) throw new Error(error.message);
  }, onSettled: () => {
    void client.invalidateQueries({ queryKey: ["learning_package_context"] });
    void client.invalidateQueries({ queryKey: ["learning_packages"] });
    void client.invalidateQueries({ queryKey: ["governed_draft_source"] });
    void client.invalidateQueries({ queryKey: ["courses"] });
  } });
  const busy = upload.isPending || finish.isPending;
  const blocked = disabled || context.isError || !context.data;
  const unfinished = (context.data?.intents.items ?? []).filter(item => item.state !== "committed");
  return <Card><CardHeader><CardTitle>Course packages</CardTitle><CardDescription>Upload an original SCORM or xAPI ZIP for this draft. Acceptance adds the CareBase runtime bridge in a separate file. Review the authored content before accepting.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {disabled && <p className="text-sm text-muted-foreground">Save or discard draft edits before changing packages.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <label>Package standard <select value={standard} disabled={blocked || busy} onChange={event => setStandard(event.target.value as typeof standard)} className="rounded border bg-background p-2">
          <option value="scorm_1_2">SCORM 1.2</option><option value="scorm_2004_4th">SCORM 2004</option><option value="xapi">xAPI</option>
        </select></label>
        <input ref={input} type="file" accept=".zip,application/zip" aria-label="Original course package" disabled={blocked || busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (file) upload.mutate({ file, versionId, standard });
        }} />
        <Button variant="outline" disabled={busy} onClick={() => { void context.refetch(); void packages.refetch(); }}>Refresh package status</Button>
      </div>
      {upload.isPending && <p role="status">Retaining the original package…</p>}
      {upload.isSuccess && <p role="status">Original package registered. Review it before acceptance. Reload the draft source before the next course edit or review.</p>}
      {upload.isError && <p role="alert" className="text-sm text-destructive">{upload.error.message}</p>}
      {context.isError && <QueryError what="package operations" error={context.error} onRetry={() => void context.refetch()} />}
      {packages.isError && <QueryError what="course packages" error={packages.error} onRetry={() => void packages.refetch()} />}
      {finish.isError && <p role="alert" className="text-sm text-destructive">{finish.error.message}</p>}
      {finish.isSuccess && <p role="status">Package operation finished. Reload the draft source before the next course edit or review.</p>}
      {(packages.data ?? []).map(pkg => <div key={pkg.id} className="space-y-2 rounded border p-3">
        <p>{pkg.standard_type} · {pkg.validation_status} · SHA {pkg.content_sha256.slice(0, 12)}…</p>
        {["pending", "validating", "rejected"].includes(pkg.validation_status) && ["scorm_1_2", "scorm_2004_4th", "xapi"].includes(pkg.standard_type) && <AcceptPackage packageId={pkg.id} disabled={blocked || busy} />}
      </div>)}
      {unfinished.map(intent => <div key={intent.operationId} className="rounded border p-3 text-sm">
        <p>{intent.operation === "upload" ? "Original upload" : "Package acceptance"} · {intent.state} · source SHA {intent.sourceSha256.slice(0, 12)}…</p>
        {intent.canFinishThisSession ? <Button disabled={blocked || busy} onClick={() => finish.mutate(intent.operationId)}>Finish verified package operation</Button>
          : <p className="text-muted-foreground">This saved operation cannot finish in the current session or draft. Refresh and explicitly upload or review the package again.</p>}
      </div>)}
      {context.data?.intents.hasMore && <p className="text-sm text-muted-foreground">Showing the 20 most recent package operations for this draft.</p>}
    </CardContent></Card>;
}
