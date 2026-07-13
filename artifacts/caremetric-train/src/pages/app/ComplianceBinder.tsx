import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, type Role } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { useBinderDownloadUrl, useListBinderExports } from "@/hooks/useComplianceBinder";
import { BinderExportButton } from "@/components/reports/BinderExportButton";
import { QueryError } from "@/components/QueryState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileArchive, History, Loader2 } from "lucide-react";

const FACILITY_ALL = "all";

// Matches request_binder_export()'s own role model: facility_manager gets an auto-derived
// facility scope from facility_assignments server-side, which this picker must never
// override, so facility_manager isn't offered the control at all. platform_admin doesn't
// reach this page (see REPORTS_VIEW_ROLES in App.tsx).
const FACILITY_PICKER_ROLES: Role[] = ["org_admin", "auditor"];

const EXPORT_STATUS_STYLE: Record<string, string> = {
  pending: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  processing: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  succeeded: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export default function ComplianceBinder() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [facilityId, setFacilityId] = useState<string>(FACILITY_ALL);

  const canScopeFacility = !!user && FACILITY_PICKER_ROLES.includes(user.role);
  const { data: facilities } = useListFacilities({}, canScopeFacility);
  const { data: exports, isError: exportsError, error: exportsErrorDetail, refetch: refetchExports } = useListBinderExports();
  const { mutate: fetchDownload, isPending: downloading, variables: downloadingJobId } = useBinderDownloadUrl();

  const handleDownloadExisting = (jobId: string) => {
    fetchDownload(jobId, {
      onSuccess: (result) => {
        if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
      },
      onError: (e: Error) =>
        toast({ title: "Couldn't download binder", description: e.message, variant: "destructive" }),
    });
  };

  const scopeLabel = (ids: string[]) => {
    if (!ids || ids.length === 0) return "Org-wide";
    if (ids.length === 1) {
      return facilities?.find(f => f.id === ids[0])?.name ?? "1 facility";
    }
    return `${ids.length} facilities`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compliance Binder</h1>
        <p className="text-muted-foreground">Generate a compliance summary PDF for your organization.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Full Facility Compliance Binder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Generates a single PDF, rebuilt from live data every time, covering roughly a dozen compliance areas:
            a citation-weighted DHS readiness summary, the facility roster and resident census (including resident
            names and other PII), staff requirements and practicum compliance with overdue detail, certificates
            issued, open alerts, policy attestation status with a signed ESIGN/UETA audit trail (who signed what,
            when, and from where), employee credentials &amp; clearances, a reportable incidents log, inspection
            items/equipment with open corrective actions, and resident RASP compliance. Exports prepare in the
            background -- large organizations no longer risk a timeout, and you can leave the page while it runs.
          </p>
          <p className="text-xs text-muted-foreground">
            Because it includes resident-identifying information, confirm who it's being shared with before
            handing a copy to a surveyor.
          </p>
          {canScopeFacility && (
            <div className="flex flex-col gap-1.5 max-w-xs">
              <label className="text-sm font-medium">Facility</label>
              <Select value={facilityId} onValueChange={setFacilityId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="All Facilities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FACILITY_ALL}>All Facilities (org-wide)</SelectItem>
                  {facilities?.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose one facility for a site-specific binder instead of the full organization -- useful when
                only one site is being surveyed.
              </p>
            </div>
          )}
          <BinderExportButton
            facilityIds={canScopeFacility && facilityId !== FACILITY_ALL ? [facilityId] : undefined}
            label="Export Binder PDF"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Recent Exports
          </CardTitle>
          <CardDescription>
            Exports from across your organization. Download links are generated fresh and expire after 10 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {exportsError ? (
            <QueryError what="recent binder exports" error={exportsErrorDetail} onRetry={() => refetchExports()} />
          ) : !exports?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No binder exports yet.</p>
          ) : (
            <div className="space-y-2">
              {exports.map(job => (
                <div key={job.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {scopeLabel(job.facility_ids)}
                      <span className="text-muted-foreground font-normal">
                        {" "}· {new Date(job.requested_at).toLocaleString()}
                      </span>
                    </p>
                    {job.status === "failed" && job.last_error_message && (
                      <p className="text-xs text-destructive truncate">{job.last_error_message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`border-0 font-medium capitalize ${EXPORT_STATUS_STYLE[job.status] ?? ""}`}>
                      {job.status}
                    </Badge>
                    {job.status === "succeeded" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={downloading && downloadingJobId === job.id}
                        onClick={() => handleDownloadExisting(job.id)}
                      >
                        {downloading && downloadingJobId === job.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Download className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
