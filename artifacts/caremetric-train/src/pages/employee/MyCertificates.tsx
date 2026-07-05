import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListCertificates } from "@/hooks/useCertificates";
import { useListCourses } from "@/hooks/useCourses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Award, ExternalLink } from "lucide-react";
import { Link } from "wouter";

export default function MyCertificates() {
  const { user } = useAuth();

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const { data: certificates, isLoading: certificatesLoading } = useListCertificates({ employeeId: employee?.id });
  const { data: courses } = useListCourses();

  const courseTitleById = useMemo(() => new Map((courses ?? []).map(c => [c.id, c.title])), [courses]);

  const isLoading = employeeLoading || certificatesLoading;
  const allCertificates = certificates ?? [];

  function isExpired(expiresAt: string | null) {
    return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
  }

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
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={expired ? "destructive" : "default"}>
                        {expired ? "Expired" : "Valid"}
                      </Badge>
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
