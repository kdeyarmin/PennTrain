import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, KeyRound, Loader2, LockKeyhole, ShieldCheck, Trash2 } from "lucide-react";

type TotpFactor = {
  id: string;
  friendly_name?: string;
  status: "verified" | "unverified";
  created_at: string;
};

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type Assurance = {
  currentLevel: string | null;
  nextLevel: string | null;
};

export default function MfaSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [assurance, setAssurance] = useState<Assurance>({ currentLevel: null, nextLevel: null });
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadSecurityState = useCallback(async () => {
    const [factorResult, assuranceResult] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);

    if (factorResult.error) throw factorResult.error;
    if (assuranceResult.error) throw assuranceResult.error;

    const totpFactors = factorResult.data.totp as TotpFactor[];
    setFactors(totpFactors);
    setAssurance({
      currentLevel: assuranceResult.data.currentLevel,
      nextLevel: assuranceResult.data.nextLevel,
    });
    setSelectedFactorId((current) => {
      if (current && totpFactors.some((factor) => factor.id === current)) return current;
      return totpFactors.find((factor) => factor.status === "verified")?.id ?? null;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSecurityState()
      .catch((error) => {
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "Couldn't load account security",
            description: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSecurityState, toast]);

  const verifiedFactors = useMemo(
    () => factors.filter((factor) => factor.status === "verified"),
    [factors],
  );

  const beginEnrollment = async () => {
    setBusyAction("enroll");
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `CareMetric Authenticator ${verifiedFactors.length + 1}`,
      });
      if (error) throw error;
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setSelectedFactorId(data.id);
      setCode("");
      await loadSecurityState();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't start enrollment",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const verifyFactor = async () => {
    const factorId = enrollment?.factorId ?? selectedFactorId;
    if (!factorId || !/^\d{6,8}$/.test(code.trim())) {
      toast({
        variant: "destructive",
        title: "Enter a valid authenticator code",
        description: "Use the 6-digit code currently shown by your authenticator app.",
      });
      return;
    }

    setBusyAction("verify");
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      });
      if (error) throw error;
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;
      setEnrollment(null);
      setCode("");
      await loadSecurityState();
      await queryClient.invalidateQueries({ queryKey: ["my_mfa_policy"] });
      toast({ title: "Authenticator verified", description: "This session now meets the AAL2 security requirement." });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Verification failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const removeFactor = async (factorId: string) => {
    setBusyAction(`remove:${factorId}`);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      // Unenrollment does not retroactively change the JWT's `aal` claim. Refresh
      // immediately so removing the last verified factor also removes AAL2
      // privileges now, not when the access token happens to expire.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        await supabase.auth.signOut();
        throw new Error("The authenticator was removed, but session assurance could not be refreshed. You were signed out for safety.");
      }
      if (enrollment?.factorId === factorId) setEnrollment(null);
      setCode("");
      await loadSecurityState();
      await queryClient.invalidateQueries({ queryKey: ["my_mfa_policy"] });
      toast({ title: "Authenticator removed" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't remove authenticator",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading account security" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Account security</p>
        <h1 className="text-3xl font-bold tracking-tight">Multi-factor authentication</h1>
        <p className="mt-2 text-muted-foreground">
          Protect privileged actions with a time-based one-time password from your authenticator app.
        </p>
      </div>

      <Alert>
        {assurance.currentLevel === "aal2" ? <CheckCircle2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
        <AlertTitle>{assurance.currentLevel === "aal2" ? "Session verified at AAL2" : "Additional verification required"}</AlertTitle>
        <AlertDescription>
          {assurance.currentLevel === "aal2"
            ? "This browser session can perform protected enterprise administration actions."
            : assurance.nextLevel === "aal2"
              ? "Verify an enrolled authenticator before performing protected enterprise administration actions."
              : "Enroll an authenticator to enable protected enterprise administration actions."}
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Authenticators</CardTitle>
            <CardDescription>Each verified factor can be used to elevate a signed-in session to AAL2.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {factors.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                No authenticator is enrolled for this account.
              </div>
            ) : (
              factors.map((factor) => (
                <div key={factor.id} className="flex items-center gap-3 rounded-lg border p-4">
                  <KeyRound className="h-5 w-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{factor.friendly_name || "Authenticator app"}</p>
                    <p className="text-xs text-muted-foreground">Added {new Date(factor.created_at).toLocaleDateString()}</p>
                  </div>
                  <Badge variant={factor.status === "verified" ? "default" : "outline"}>{factor.status}</Badge>
                  {factor.status === "verified" && assurance.currentLevel !== "aal2" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedFactorId(factor.id);
                        setEnrollment(null);
                        setCode("");
                      }}
                    >
                      Verify
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${factor.friendly_name || "authenticator"}`}
                    disabled={busyAction !== null}
                    onClick={() => void removeFactor(factor.id)}
                  >
                    {busyAction === `remove:${factor.id}`
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              ))
            )}

            <Button type="button" variant="outline" disabled={busyAction !== null || !!enrollment} onClick={() => void beginEnrollment()}>
              {busyAction === "enroll" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Add authenticator
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{enrollment ? "Finish enrollment" : "Verify this session"}</CardTitle>
            <CardDescription>
              {enrollment ? "Scan the QR code, then enter the current code." : "Enter a code from a verified authenticator."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {enrollment ? (
              <div className="space-y-3">
                <div className="flex justify-center rounded-lg bg-white p-3">
                  <img src={enrollment.qrCode} alt="Authenticator enrollment QR code" className="h-48 w-48" />
                </div>
                <div>
                  <Label>Manual setup key</Label>
                  <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">{enrollment.secret}</code>
                </div>
              </div>
            ) : verifiedFactors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add an authenticator to begin.</p>
            ) : assurance.currentLevel === "aal2" ? (
              <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
                This session is already verified. You may return to the enterprise control plane.
              </div>
            ) : null}

            {(enrollment || (verifiedFactors.length > 0 && assurance.currentLevel !== "aal2")) ? (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void verifyFactor();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="mfa-code">Authenticator code</Label>
                  <Input
                    id="mfa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={8}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    disabled={busyAction !== null}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busyAction !== null || !selectedFactorId}>
                  {busyAction === "verify" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify authenticator
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
