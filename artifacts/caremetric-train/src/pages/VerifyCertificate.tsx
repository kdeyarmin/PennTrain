import { useParams } from "wouter";
import { useVerifyCertificate } from "@/hooks/useCertificates";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldX, XCircle } from "lucide-react";

export default function VerifyCertificate() {
  const { slug } = useParams<{ slug: string }>();
  const { data: result, isLoading } = useVerifyCertificate(slug);

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500/[0.03] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

      <div className="w-full max-w-[480px] space-y-8 relative z-10 px-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="h-14 w-14 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
            <ShieldCheck className="h-7 w-7 text-primary-foreground" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-bold tracking-tight text-foreground">CareMetric Train</h1>
            <p className="text-sm text-muted-foreground">Certificate Verification</p>
          </div>
        </div>

        <Card className="border-border/50 shadow-xl shadow-black/[0.04] backdrop-blur-sm">
          {isLoading ? (
            <CardContent className="py-10 space-y-4">
              <div className="h-6 bg-muted animate-pulse rounded w-2/3 mx-auto" />
              <div className="h-4 bg-muted animate-pulse rounded w-1/2 mx-auto" />
              <div className="h-4 bg-muted animate-pulse rounded w-1/3 mx-auto" />
            </CardContent>
          ) : !result ? (
            <CardContent className="py-10">
              <div className="flex flex-col items-center text-center gap-3">
                <XCircle className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-semibold text-foreground">Certificate not found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    We couldn't find a certificate matching this link. Please double-check the URL or
                    contact the issuing organization.
                  </p>
                </div>
              </div>
            </CardContent>
          ) : (
            <>
              <CardHeader className="pb-2 flex flex-col items-center text-center gap-2">
                {result.is_valid ? (
                  <Badge className="gap-1.5 px-3 py-1 text-sm bg-success text-success-foreground hover:bg-success/80">
                    <ShieldCheck className="h-4 w-4" />
                    Valid Certificate
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1.5 px-3 py-1 text-sm">
                    <ShieldX className="h-4 w-4" />
                    Expired Certificate
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="pt-4 space-y-5">
                <div className="text-center space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">This certifies that</p>
                  <p className="text-xl font-bold text-foreground">{result.employee_name}</p>
                  <p className="text-sm text-muted-foreground">has successfully completed</p>
                  <p className="text-lg font-semibold text-foreground">{result.course_title}</p>
                </div>

                <div className="border-t pt-4 grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Issued by</p>
                    <p className="text-sm font-medium text-foreground mt-0.5">{result.organization_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Issued on</p>
                    <p className="text-sm font-medium text-foreground mt-0.5">
                      {new Date(result.issued_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {result.expires_at && (
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">
                      {result.is_valid ? "Valid through" : "Expired on"}
                    </p>
                    <p className="text-sm font-medium text-foreground mt-0.5">
                      {new Date(result.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </CardContent>
            </>
          )}
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60">
          55 Pa. Code Chapter 2600 Compliance Platform
        </p>
      </div>
    </div>
  );
}
