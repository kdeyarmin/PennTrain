import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import {
  HRIS_PROVIDER_TYPES,
  hrisSourceSystemIssues,
  useCreateHrisSourceSystem,
  useHrisSourceSystems,
} from "@/hooks/useHrisImportRuns";

/**
 * Registering the source system an HRIS import run belongs to
 * (RELEASE_READINESS_PLAN 4.3, imports D2).
 *
 * THE GAP THIS CLOSES. `PHASE3_OPERATIONS.md` describes a four-step adapter contract whose first
 * step is "Register a source in `hris_source_systems`". Nothing in the product performed it and
 * nothing seeds one, so on every deployment the Imports tab opened on "No pilot or active source
 * configured", Start run was disabled, and the run id that Validate, the merge decisions and Apply
 * all require could never be obtained. The whole console was unreachable behind a missing row.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not stage rows, and it is not an adapter.
 * `stage_hris_import_row` refuses anybody who is not `service_role`, which is the design -- source
 * payloads and provider credentials stay out of the browser -- and the same document is explicit
 * that "The repository intentionally does not embed provider credentials or vendor-specific network
 * clients. The pilot adapter must be deployed in the approved integration runtime". So the honest
 * shape of the product half is: let an administrator declare the source, and say plainly that a run
 * sits in "Awaiting staged rows" until the adapter for it is deployed and pushes. Inventing
 * credentials or a vendor client here would be inventing an integration, not shipping one.
 */
export function HrisSourceSystems({ organizationId }: { organizationId: string | null }) {
  const fieldIds = useId();
  const { toast } = useToast();
  const sources = useHrisSourceSystems(organizationId);
  const create = useCreateHrisSourceSystem();

  const [sourceKey, setSourceKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [providerType, setProviderType] = useState<string>("sftp");
  const [importMode, setImportMode] = useState<"delta" | "full">("delta");

  const issues = hrisSourceSystemIssues({ organizationId: organizationId ?? "", sourceKey, displayName });
  const rows = sources.data ?? [];

  const submit = async () => {
    if (!organizationId) return;
    try {
      await create.mutateAsync({ organizationId, sourceKey, displayName, providerType, importMode });
      setSourceKey("");
      setDisplayName("");
      toast({
        title: "Source system registered",
        description: "It is available to Start an import run. Rows arrive when its adapter stages them.",
      });
    } catch (error) {
      toast({ title: "Source could not be registered", description: errorText(error), variant: "destructive" });
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Source systems</CardTitle>
        <CardDescription>
          An import run belongs to a registered source. Registering one here is step 1 of the HRIS
          adapter contract; the adapter itself runs outside this application under a service-role
          credential and is what stages rows into the runs you open. Until it does, a run stays in
          &ldquo;Awaiting staged rows&rdquo; with nothing to validate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sources.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : sources.isError ? (
          <QueryError what="HRIS source systems" error={sources.error} onRetry={() => void sources.refetch()} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No source system is registered, so no import run can be started yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{row.display_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.source_key} · {row.provider_type} · {row.import_mode} · mapping v{row.mapping_version}
                    {row.last_cursor ? ` · last cursor ${row.last_cursor}` : " · never imported"}
                  </p>
                </div>
                <Badge variant={row.status === "active" ? "default" : "secondary"}>{row.status}</Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${fieldIds}-key`}>Source key</Label>
            <Input
              id={`${fieldIds}-key`}
              value={sourceKey}
              onChange={(event) => setSourceKey(event.target.value)}
              placeholder="paycom-east"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldIds}-name`}>Display name</Label>
            <Input
              id={`${fieldIds}-name`}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Paycom — Eastern region"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldIds}-provider`}>How the adapter delivers</Label>
            <Select value={providerType} onValueChange={setProviderType}>
              <SelectTrigger id={`${fieldIds}-provider`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {HRIS_PROVIDER_TYPES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldIds}-mode`}>Import mode</Label>
            <Select value={importMode} onValueChange={(value) => setImportMode(value === "full" ? "full" : "delta")}>
              <SelectTrigger id={`${fieldIds}-mode`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="delta">Delta — changes since the last cursor</SelectItem>
                <SelectItem value="full">Full — the whole roster each run</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            {issues.map((issue) => <p key={issue} className="text-xs text-muted-foreground">{issue}</p>)}
            <p className="text-xs text-muted-foreground">
              New sources are registered in <span className="font-medium">pilot</span> status, which is
              what the run-start picker accepts.
            </p>
            <Button disabled={issues.length > 0 || create.isPending} onClick={() => void submit()}>
              Register source system
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
