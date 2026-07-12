import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";

export default function Demo() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500/[0.03] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

      <div className="w-full max-w-[420px] space-y-8 relative z-10 px-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <Link href="/" aria-label="CareMetric Train home">
            <LogoMark className="h-20 w-20" />
          </Link>
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-bold tracking-tight" style={{ color: BRAND_BLUE }}>
              <BrandName />
            </h1>
            <p className="text-sm text-muted-foreground">Healthcare Learning &amp; Compliance Platform</p>
          </div>
        </div>

        <Card className="border-border/50 shadow-xl shadow-black/[0.04] backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Demo access</CardTitle>
            <CardDescription>Request a dedicated demo login to explore sample Sunrise Healthcare data safely</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This public page does not expose shared demo credentials. Contact the CareMetric team for a dedicated demo account.
            </p>
            <p className="mt-4 text-center text-[13px] text-muted-foreground">
              Have credentials already?{" "}
              <Link href="/login" className="font-medium text-primary hover:text-primary/80">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60">
          Demo data only &mdash; changes here don&apos;t affect any real facility.
        </p>
      </div>
    </div>
  );
}
