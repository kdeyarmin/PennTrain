import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { useCheckinViaToken } from "@/hooks/useTrainingClasses";
import { consumePublicAccessToken } from "@/lib/publicAccessToken";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2, LogOut } from "lucide-react";

// Public-ish route (any authenticated role can land here from a scanned QR) -- the RPC itself
// resolves "does this signed-in account have an employee record in this class's org," so there's
// no separate role gate needed beyond being logged in at all.
export default function CheckIn() {
  const { token } = useParams<{ token?: string }>();
  const [accessToken] = useState(() =>
    consumePublicAccessToken(token, "checkin-access-token", "/checkin"),
  );
  const { mutate: checkin, data, error, isPending, isIdle } = useCheckinViaToken();

  useEffect(() => {
    if (accessToken) checkin(accessToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const checkedOut = data?.checked_out_at != null;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Class Check-In</CardTitle>
          {accessToken && !isPending && !error && (
            <CardDescription>{checkedOut ? "You're checked out." : "You're checked in."}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pb-8">
          {!accessToken ? (
            <>
              <XCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-center text-muted-foreground">This check-in link is missing or expired. Scan the QR code again or ask the trainer for help.</p>
            </>
          ) : isPending || isIdle ? (
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          ) : error ? (
            <>
              <XCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-center text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
            </>
          ) : checkedOut ? (
            <>
              <LogOut className="h-12 w-12 text-primary" />
              <p className="text-sm text-center text-muted-foreground">Thanks for attending. Your seat time has been recorded.</p>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-12 w-12 text-success" />
              <p className="text-sm text-center text-muted-foreground">Scan the same QR code again when you leave to check out.</p>
            </>
          )}
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground underline">
            Return to CareMetric CareBase
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
