import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import QRCode from "qrcode";
import { Award, Download, ExternalLink, QrCode, ShieldCheck, ShieldX } from "lucide-react";
import { usePublicTrainingPassport } from "@/hooks/useProductExperience";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoMark, BrandName } from "@/components/brand/Logo";
import { QueryError } from "@/components/QueryState";
import { absoluteAppUrl } from "@/lib/appUrl";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

export default function TrainingPassport() {
  // BACKLOG J74 (P3, guest). Without this the tab, the canonical and the robots tag stayed
  // whatever the last route left in index.html -- the homepage's, on a page reached only by
  // holding a credential. The prerendered head says the same thing for a crawler.
  usePageMeta({ ...MARKETING_ROUTE_META["/passport"], path: "/passport" });
  const { slug } = useParams<{ slug: string }>();
  const passport = usePublicTrainingPassport(slug);
  const [qrCode, setQrCode] = useState<string | null>(null);
  useEffect(() => {
    if (!slug) return;
    void QRCode.toDataURL(absoluteAppUrl(`/passport/${slug}`), { width: 220, margin: 1 }).then(setQrCode);
  }, [slug]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 print:bg-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden"><div className="flex items-center gap-3"><LogoMark className="h-12 w-12" /><div><BrandName className="font-bold" /><p className="text-sm text-muted-foreground">Portable training passport</p></div></div><Button onClick={() => window.print()}><Download className="mr-2 h-4 w-4" />Save as PDF</Button></div>
        {passport.isLoading ? <Card><CardContent className="py-16 text-center text-muted-foreground">Loading passport…</CardContent></Card> : passport.isError ? (
          // "Revoked, replaced, or does not exist" is a claim about the link. A failed fetch
          // is a claim about us -- saying the first when the second happened sends the holder
          // back to their employer for a replacement they don't need.
          <Card><CardContent className="py-10"><QueryError what="this training passport" error={passport.error} onRetry={() => void passport.refetch()} /></CardContent></Card>
        ) : !passport.data ? (
          <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><ShieldX className="h-10 w-10 text-muted-foreground" /><h1 className="text-xl font-semibold">Passport unavailable</h1><p className="max-w-md text-sm text-muted-foreground">This link was revoked, replaced, or does not exist.</p></CardContent></Card>
        ) : (
          <>
            <Card>
              {/* "CE hours" was the course's estimated duration, printed under a "Verified
                  transcript" badge -- a continuing-education claim CareMetric is not in a position
                  to make and the compliance model never asserted (BACKLOG.md J74, Train). What is
                  printed now is the recorded compliance credit, over the certificates that actually
                  carry one, and nothing at all for the ones that do not. */}
              <CardHeader><div className="flex flex-wrap items-start justify-between gap-4"><div><Badge className="mb-3"><ShieldCheck className="mr-1 h-3.5 w-3.5" />Verified transcript</Badge><CardTitle className="text-3xl">{passport.data.employeeName}</CardTitle><p className="mt-1 text-muted-foreground">{passport.data.certificateCount} certificate{passport.data.certificateCount === 1 ? "" : "s"}{passport.data.creditedCertificateCount > 0 ? ` · ${passport.data.totalCreditHours} training hours credited across ${passport.data.creditedCertificateCount} of them` : ""}</p></div>{qrCode && <div className="text-center"><img src={qrCode} alt="QR code for this training passport" className="h-32 w-32" /><p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><QrCode className="h-3 w-3" />Scan to verify</p></div>}</div></CardHeader>
            </Card>
            <p className="text-xs text-muted-foreground">Each entry is a course completion recorded in CareMetric CareBase and verifiable at the link beside it. Hours shown are the compliance credit recorded for that completion; CareMetric is not a continuing-education accrediting body and this transcript makes no CE claim.</p>
            <div className="space-y-3">{passport.data.certificates.map((certificate) => (
              <Card key={certificate.certificateId}><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="flex items-center gap-2 font-semibold"><Award className="h-4 w-4 text-primary" />{certificate.courseTitle}</p><p className="mt-1 text-sm text-muted-foreground">Issued {new Date(certificate.issuedAt).toLocaleDateString()}{certificate.creditHours != null ? ` · ${certificate.creditHours} training hours credited` : ""}{certificate.expiresAt ? ` · ${certificate.isValid ? "Valid through" : "Expired"} ${new Date(certificate.expiresAt).toLocaleDateString()}` : ""}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{certificate.credentialNumber}</p></div><div className="flex items-center gap-2"><Badge variant={certificate.isValid ? "default" : "destructive"}>{certificate.isValid ? "Valid" : "Expired"}</Badge><Button asChild variant="outline" size="sm" className="print:hidden"><Link href={certificate.verificationPath}>Verify <ExternalLink className="ml-1 h-3.5 w-3.5" /></Link></Button></div></CardContent></Card>
            ))}</div>
          </>
        )}
      </div>
    </div>
  );
}
