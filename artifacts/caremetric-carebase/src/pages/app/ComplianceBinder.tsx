import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, type Role } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { useBinderDownloadUrl, useListBinderExports, type BinderAppendixSection } from "@/hooks/useComplianceBinder";
import { downloadBlob } from "@/lib/browserDownload";
import { appendixFiles, buildAppendixArchive } from "@/lib/binderAppendixArchive";
import { BinderExportButton } from "@/components/reports/BinderExportButton";
import { QueryError } from "@/components/QueryState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileArchive, FileSpreadsheet, History, Loader2 } from "lucide-react";

const FACILITY_ALL = "all";

// Matches request_binder_export()'s own role model: facility_manager gets an auto-derived
// facility scope from facility_assignments server-side, which this picker must never
// override, so facility_manager isn't offered the control at all. platform_admin doesn't
// reach this page (see REPORTS_VIEW_ROLES in App.tsx).
const FACILITY_PICKER_ROLES: Role[] = ["org_admin", "auditor"];

const EXPORT_STATUS_STYLE: Record<string, string> = {
  pending: "bg-blue-100 text-blue-900",
  processing: "bg-amber-100 text-amber-900",
  succeeded: "bg-green-100 text-green-900",
  failed: "bg-red-100 text-red-900",
};

export default function ComplianceBinder() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [facilityId, setFacilityId] = useState<string>(FACILITY_ALL);

  const canScopeFacility = !!user && FACILITY_PICKER_ROLES.includes(user.role);
  const { data: facilityRows } = useListFacilities({}, canScopeFacility);
  const facilities = facilityRows?.filter((facility) => !facility.is_sandbox);
  const { data: exports, isLoading: exportsLoading, isError: exportsError, error: exportsErrorDetail, refetch: refetchExports } = useListBinderExports();
  const { mutate: fetchDownload, isPending: downloading, variables: downloadingJobId } = useBinderDownloadUrl();

  // Fetches the manifest and every section CSV and delivers them as ONE archive. Handing over a
  // dozen separate files put the operator behind the browser's automatic-downloads permission --
  // one prompt covering the batch in current Chrome, Firefox and Safari -- and declining it
  // silently dropped every file after the first. Worse, this code could not tell: downloadBlob
  // hands a blob to the browser and returns, with no callback, promise, or readable outcome, so
  // the old success toast could only claim files were "handed over" and name the permission. A
  // single save is never gated, so the failure is gone rather than described.
  //
  // What remains is observable and is reported: a signed URL can expire or 404 between the edge
  // function issuing it and this code fetching it. Then the archive still ships with whatever was
  // retrievable, but marked INCOMPLETE in its filename and carrying MISSING-SECTIONS.txt inside --
  // both of which survive the file being emailed to a surveyor, which a toast on this page does
  // not. See binderAppendixArchive.ts.
  const saveAppendixArchive = async (
    jobId: string,
    manifestUrl: string | undefined,
    sections: BinderAppendixSection[],
  ) => {
    const files = appendixFiles(manifestUrl, sections);
    if (files.length === 0) {
      toast({
        title: "CSV appendix not available",
        description: "This export recorded appendix sections but stored no CSVs. Re-export to generate them.",
        variant: "destructive",
      });
      return;
    }
    const archive = await buildAppendixArchive(jobId, files);
    if (!archive) {
      toast({
        title: "Couldn't download CSV appendix",
        description: `None of the ${files.length} appendix files could be fetched — the download links have most likely expired. Re-export to get a fresh set.`,
        variant: "destructive",
      });
      return;
    }
    downloadBlob(archive.filename, new Blob([archive.bytes], { type: "application/zip" }));
    if (archive.failed.length > 0) {
      toast({
        title: `Appendix downloaded with ${archive.failed.length} of ${files.length} files missing`,
        description: `Missing: ${archive.failed.join(", ")}. The archive is named INCOMPLETE and lists them inside. Re-export to get a fresh set of links.`,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: `Downloading ${archive.fetched.length} appendix files as one archive`,
      description: `Saved as ${archive.filename}. Inclusion counts are set in each CSV's header row.`,
    });
  };

  const handleDownloadExisting = (jobId: string, mode: "pdf" | "appendix" = "pdf") => {
    fetchDownload(jobId, {
      onSuccess: (result) => {
        if (mode === "pdf") {
          if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
          return;
        }
        const sections = result.appendix?.sections ?? [];
        if (sections.length === 0) {
          toast({
            title: "CSV appendix not available",
            description: "This export was generated before the appendix format shipped, or the appendix failed to store. Re-export to get full CSVs.",
          });
          return;
        }
        // The appendix is a manifest plus one CSV per section -- a dozen files for a full
        // binder. This used to call window.open() once per file: every browser blocks all but
        // the first popup from a handler that is already past an await, so the operator got one
        // tab, no error, and a toast claiming every section had opened. Fetch each signed URL and
        // pack them into a single archive instead -- one save, always permitted, and the set stays
        // together as the operator hands it on.
        void saveAppendixArchive(jobId, result.appendix?.manifestUrl, sections);
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
            when, and from where), employee credentials & clearances, a reportable incidents log, inspection
            items/equipment with open corrective actions, and resident RASP compliance. Exports prepare in the
            background -- large organizations no longer risk a timeout, and you can leave the page while it runs.
          </p>
          <p className="text-xs text-muted-foreground">
            Because it includes resident-identifying information, confirm who it's being shared with before
            handing a copy to a surveyor.
          </p>
          <p className="text-xs text-muted-foreground">
            Detail lists in the PDF are capped at 500 rows per section (with a clear truncation note). Summary
            counts remain complete. Use <strong>CSV appendix</strong> on a finished export for the full,
            untruncated machine-readable section lists and inclusion counts -- it downloads as a single
            .zip holding one CSV per section plus a manifest.
          </p>
          {canScopeFacility && (
            <div className="flex flex-col gap-1.5 max-w-xs">
              <label className="text-sm font-medium">Facility</label>
              <Select value={facilityId} onValueChange={setFacilityId}>
                <SelectTrigger className="w-64" aria-label="Facility">
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
          ) : exportsLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading binder exports…</p>
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
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          title="Download PDF"
                          disabled={downloading && downloadingJobId === job.id}
                          onClick={() => handleDownloadExisting(job.id, "pdf")}
                        >
                          {downloading && downloadingJobId === job.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Download className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          title="Download CSV appendix (.zip)"
                          disabled={downloading && downloadingJobId === job.id}
                          onClick={() => handleDownloadExisting(job.id, "appendix")}
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                        </Button>
                      </>
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
