import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListCertificates, useGenerateCertificatePdf } from "@/hooks/useCertificates";
import { useListCourses } from "@/hooks/useCourses";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
import { Award, ExternalLink, Download, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useMyTrainingPassport } from "@/hooks/useProductExperience";

// Certificate PDFs render on a background job queue; while one is still pending/processing,
// poll the list so the action button flips to "Download" without a manual refresh.
const PDF_POLL_INTERVAL_MS = 15_000;

export default function MyCertificates() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  // Gate on a resolved employee id -- see useListCertificates' own comment on why `enabled`, not
  // just the filter, is required to avoid an unscoped fetch-then-refetch on every page load.
  const {
    data: certificates,
    isLoading: certificatesLoading,
    isError: certificatesError,
    error: certificatesErrorDetail,
    refetch: refetchCertificates,
  } = useListCertificates(
    { employeeId: employee?.id },
    {
      enabled: !!employee?.id,
      refetchInterval: (certs) =>
        certs?.some((c) => c.pdf_status === "pending" || c.pdf_status === "processing")
          ? PDF_POLL_INTERVAL_MS
          : false,
    },
  );
  const { data: courses } = useListCourses();
  const { mutateAsync: generatePdf } = useGenerateCertificatePdf();
  const passport = useMyTrainingPassport();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const courseTitleById = useMemo(() => new Map((courses ?? []).map(c => [c.id, c.title])), [courses]);

  const isLoading = employeeLoading || certificatesLoading;
  const allCertificates = certificates ?? [];

  function isExpired(expiresAt: string | null) {
    return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
  }

  const handleDownload = async (certificateId: string) => {
    setDownloadingId(certificateId);
    try {
      const { url } = await generatePdf(certificateId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({
        title: "Could not generate certificate PDF",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Certificates</h1>
        <p className="text-muted-foreground">View and verify certificates you've earned from completed training.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            Portable training passport
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Create one employee-owned link containing your valid certificates and continuing-education hours. You can revoke or replace it at any time.
          </p>
          {passport.data?.is_active ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline"><Link href={`/passport/${passport.data.slug}`}><ExternalLink className="mr-2 h-4 w-4" />Open passport</Link></Button>
              <Button variant="outline" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/passport/${passport.data!.slug}`).then(() => toast({ title: "Passport link copied" }))}>Copy share link</Button>
              <Button variant="destructive" disabled={passport.revoke.isPending} onClick={() => passport.revoke.mutate(undefined, { onSuccess: () => toast({ title: "Passport revoked" }), onError: (error: Error) => toast({ title: "Passport could not be revoked", description: error.message, variant: "destructive" }) })}>Revoke link</Button>
            </div>
          ) : (
            <Button disabled={passport.enable.isPending || !employee?.id} onClick={() => passport.enable.mutate(false, { onSuccess: () => toast({ title: "Training passport created" }), onError: (error: Error) => toast({ title: "Passport could not be created", description: error.message, variant: "destructive" }) })}>
              {passport.enable.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Award className="mr-2 h-4 w-4" />}Create my passport
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            Certificates ({allCertificates.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {certificatesError ? (
            <QueryError what="your certificates" error={certificatesErrorDetail} onRetry={() => refetchCertificates()} />
          ) : isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}
            </div>
          ) : allCertificates.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No certificates yet.</p>
          ) : (
            <div className="space-y-2">
              {allCertificates.map(cert => {
                const expired = isExpired(cert.expires_at);
                return (
                  <div
                    key={cert.id}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg border"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {courseTitleById.get(cert.course_id) ?? `Course #${cert.course_id.slice(0, 8)}`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Issued {formatDateForDisplay(cert.issued_at)}
                        {cert.expires_at && (
                          <> &middot; {expired ? "Expired" : "Expires"} {formatDateForDisplay(cert.expires_at)}</>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                        {cert.credential_number}
                      </p>
                      {cert.pdf_status !== "ready" && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          PDF {cert.pdf_status === "failed" ? "needs another attempt" : "is being prepared"}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={expired ? "destructive" : "default"}>
                        {expired ? "Expired" : "Valid"}
                      </Badge>
                      <Button
                        variant="outline"
                        disabled={downloadingId === cert.id}
                        onClick={() => handleDownload(cert.id)}
                      >
                        {downloadingId === cert.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {downloadingId === cert.id
                          ? "Preparing..."
                          : cert.pdf_status === "ready"
                            ? "Download"
                            : cert.pdf_status === "failed"
                              ? "Retry PDF"
                              : "Prepare PDF"}
                      </Button>
                      <Link
                        href={`/verify/${cert.slug}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        Verify
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
