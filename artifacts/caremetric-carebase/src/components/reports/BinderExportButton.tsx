import { useEffect, useRef, useState } from "react";
import {
  useBinderDownloadUrl,
  useGetBinderExport,
  useRequestBinderExport,
} from "@/hooks/useComplianceBinder";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Download, FileArchive, Loader2, RotateCcw } from "lucide-react";

interface BinderExportButtonProps {
  /** Only honored for platform_admin -- every other role always exports their own organization. */
  organizationId?: string;
  /** org_admin/auditor narrowing; omit for org-wide. */
  facilityIds?: string[];
  label?: string;
  /** Fired once when an export job reaches "succeeded", with its job id and the facility scope the
   * server actually assigned (managers are auto-scoped to all their assigned facilities, so this
   * may be broader than facilityIds). Lets a caller react to a completed render -- e.g. Survey Day
   * pins the fresh binder only when its scope matches the session's single facility. */
  onCompleted?: (jobId: string, facilityIds: string[] | null) => void;
}

/**
 * Request-and-track control for asynchronous binder exports: enqueue on click, poll the
 * job while the background worker renders, then offer the signed download. Shared by the
 * Compliance Binder page, Inspection Readiness, and the platform org detail page.
 */
export function BinderExportButton({ organizationId, facilityIds, label = "Export Binder PDF", onCompleted }: BinderExportButtonProps) {
  const { toast } = useToast();
  const [jobId, setJobId] = useState<string | null>(null);
  const { mutate: requestExport, isPending: requesting } = useRequestBinderExport();
  const { data: job } = useGetBinderExport(jobId ?? undefined);
  const { mutate: fetchDownload, isPending: downloading } = useBinderDownloadUrl();

  // Fire onCompleted exactly once per job when the polled status first reaches "succeeded" (the
  // status is a render state, not an event). The ref guard survives re-renders and re-polls.
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  const completedJobRef = useRef<string | null>(null);
  useEffect(() => {
    if (jobId && job?.status === "succeeded" && completedJobRef.current !== jobId) {
      completedJobRef.current = jobId;
      onCompletedRef.current?.(jobId, (job.facility_ids as string[] | null) ?? null);
    }
  }, [jobId, job?.status, job?.facility_ids]);

  const handleRequest = () => {
    requestExport(
      { organizationId, facilityIds },
      {
        onSuccess: (row) => {
          setJobId(row.id);
          toast({
            title: row.status === "processing" ? "Binder export already in progress" : "Binder export started",
            description: "The PDF is prepared in the background -- this usually takes a minute or two. You can leave this page and come back.",
          });
        },
        onError: (e: Error) =>
          toast({ title: "Couldn't request binder export", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleDownload = () => {
    if (!jobId) return;
    fetchDownload(jobId, {
      onSuccess: (result) => {
        if (result.url) {
          window.open(result.url, "_blank", "noopener,noreferrer");
        } else {
          toast({ title: "The binder isn't ready yet", description: "Try again in a moment." });
        }
      },
      onError: (e: Error) =>
        toast({ title: "Couldn't download binder", description: e.message, variant: "destructive" }),
    });
  };

  if (jobId && job) {
    if (job.status === "succeeded") {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleDownload} disabled={downloading}>
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {downloading ? "Preparing link..." : "Download PDF"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setJobId(null)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> New export
          </Button>
        </div>
      );
    }
    if (job.status === "failed") {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">
            The export failed{job.last_error_message ? `: ${job.last_error_message}` : "."}
          </p>
          <Button variant="outline" size="sm" onClick={() => { setJobId(null); handleRequest(); }}>
            Try again
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing binder...
        </Button>
        <p className="text-xs text-muted-foreground">
          Running in the background -- you can leave this page and come back.
        </p>
      </div>
    );
  }

  return (
    <Button onClick={handleRequest} disabled={requesting}>
      {requesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}
      {requesting ? "Requesting..." : label}
    </Button>
  );
}
