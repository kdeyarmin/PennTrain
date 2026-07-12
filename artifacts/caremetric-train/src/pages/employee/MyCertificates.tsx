<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/employee/MyCertificates.tsx
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListCertificates } from "@/hooks/useCertificates";
import { useListCourses } from "@/hooks/useCourses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Award, ExternalLink } from "lucide-react";
=======
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListCertificates, useGenerateCertificatePdf } from "@/hooks/useCertificates";
import { useListCourses } from "@/hooks/useCourses";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Award, ExternalLink, Download, Loader2 } from "lucide-react";
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/employee/MyCertificates.tsx
import { Link } from "wouter";

export default function MyCertificates() {
  const { user } = useAuth();
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/employee/MyCertificates.tsx

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const { data: certificates, isLoading: certificatesLoading } = useListCertificates({ employeeId: employee?.id });
  const { data: courses } = useListCourses();
=======
  const { toast } = useToast();

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  // Gate on a resolved employee id -- see useListCertificates' own comment on why `enabled`, not
  // just the filter, is required to avoid an unscoped fetch-then-refetch on every page load.
  const { data: certificates, isLoading: certificatesLoading } = useListCertificates(
    { employeeId: employee?.id },
    { enabled: !!employee?.id },
  );
  const { data: courses } = useListCourses();
  const { mutateAsync: generatePdf } = useGenerateCertificatePdf();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/employee/MyCertificates.tsx

  const courseTitleById = useMemo(() => new Map((courses ?? []).map(c => [c.id, c.title])), [courses]);

  const isLoading = employeeLoading || certificatesLoading;
  const allCertificates = certificates ?? [];

  function isExpired(expiresAt: string | null) {
    return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
  }

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/employee/MyCertificates.tsx
=======
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

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/employee/MyCertificates.tsx
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Certificates</h1>
        <p className="text-muted-foreground">View and verify certificates you've earned from completed courses.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            Certificates ({allCertificates.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
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
                        Issued {new Date(cert.issued_at).toLocaleDateString()}
                        {cert.expires_at && (
                          <> &middot; {expired ? "Expired" : "Expires"} {new Date(cert.expires_at).toLocaleDateString()}</>
                        )}
                      </p>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/employee/MyCertificates.tsx
=======
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                        {cert.credential_number}
                      </p>
                      {cert.pdf_status !== "ready" && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          PDF {cert.pdf_status === "failed" ? "needs another attempt" : "is being prepared"}
                        </p>
                      )}
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/employee/MyCertificates.tsx
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={expired ? "destructive" : "default"}>
                        {expired ? "Expired" : "Valid"}
                      </Badge>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/employee/MyCertificates.tsx
=======
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
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/employee/MyCertificates.tsx
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
