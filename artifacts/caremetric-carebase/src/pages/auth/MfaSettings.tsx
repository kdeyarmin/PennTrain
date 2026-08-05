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
import { clearLocalSessionState } from "@/lib/auth";
import {
  describeMfaError,
  isSmsMfaEnabled,
  maskMfaPhone,
  mfaFactorLabel,
  normalizeMfaPhone,
  toMfaFactors,
  type MfaFactor,
  type MfaFactorType,
} from "@/lib/mfaFactors";
import { CheckCircle2, KeyRound, Loader2, LockKeyhole, MessageSquare, ShieldCheck, Trash2 } from "lucide-react";

type Enrollment = {
  factorId: string;
  factorType: MfaFactorType;
  qrCode?: string;
  secret?: string;
  phone?: string;
};

type Assurance = {
  currentLevel: string | null;
  nextLevel: string | null;
};

/** A phone factor can only be verified against a challenge that actually sent a code. */
type PendingChallenge = {
  factorId: string;
  challengeId: string;
};

export default function MfaSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const smsAvailable = isSmsMfaEnabled();
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [assurance, setAssurance] = useState<Assurance>({ currentLevel: null, nextLevel: null });
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null);
  const [phoneEntry, setPhoneEntry] = useState<string | null>(null);
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

    // `all` is the only list that includes still-unverified factors -- `totp` and
    // `phone` are pre-filtered to verified ones, and an enrollment in progress has
    // to stay visible until its code is confirmed.
    const allFactors = toMfaFactors(factorResult.data.all);
    setFactors(allFactors);
    setAssurance({
      currentLevel: assuranceResult.data.currentLevel,
      nextLevel: assuranceResult.data.nextLevel,
    });
    setSelectedFactorId((current) => {
      if (current && allFactors.some((factor) => factor.id === current)) return current;
      return allFactors.find((factor) => factor.status === "verified")?.id ?? null;
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
            description: describeMfaError(error),
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

  const activeFactor = useMemo(() => {
    const activeId = enrollment?.factorId ?? selectedFactorId;
    return factors.find((factor) => factor.id === activeId) ?? null;
  }, [enrollment?.factorId, factors, selectedFactorId]);

  const activeFactorType: MfaFactorType = enrollment?.factorType ?? activeFactor?.factor_type ?? "totp";
  const isPhoneFlow = activeFactorType === "phone";
  /** SMS codes only exist once a challenge has been issued for the factor in play. */
  const awaitingSms = isPhoneFlow && challenge?.factorId !== (enrollment?.factorId ?? selectedFactorId);

  const beginTotpEnrollment = async () => {
    setBusyAction("enroll");
    try {
      const totpCount = factors.filter((factor) => factor.factor_type === "totp").length;
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `CareMetric Authenticator ${totpCount + 1}`,
      });
      if (error) throw error;
      setEnrollment({
        factorId: data.id,
        factorType: "totp",
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setChallenge(null);
      setSelectedFactorId(data.id);
      setPhoneEntry(null);
      setCode("");
      await loadSecurityState();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't start enrollment",
        description: describeMfaError(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const beginPhoneEnrollment = async () => {
    const phone = normalizeMfaPhone(phoneEntry ?? "");
    if (!phone) {
      toast({
        variant: "destructive",
        title: "Enter a mobile number",
        description: "Use a number that can receive text messages, for example (555) 123-4567.",
      });
      return;
    }

    setBusyAction("enroll");
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "phone",
        friendlyName: `Text message ${maskMfaPhone(phone)}`,
        phone,
      });
      if (error) throw error;
      setEnrollment({ factorId: data.id, factorType: "phone", phone });
      setSelectedFactorId(data.id);
      setCode("");
      await loadSecurityState();
      await sendSmsCode(data.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't start enrollment",
        description: describeMfaError(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  /** Issues the challenge that actually delivers the SMS, for enrollment and for step-up alike. */
  const sendSmsCode = async (factorId: string) => {
    const wasBusy = busyAction;
    if (!wasBusy) setBusyAction("send-code");
    try {
      const { data, error } = await supabase.auth.mfa.challenge({ factorId, channel: "sms" });
      if (error) throw error;
      setChallenge({ factorId, challengeId: data.id });
      setCode("");
      toast({
        title: "Verification code sent",
        description: "Enter the code we just texted you. It expires in a few minutes.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't send the code",
        description: describeMfaError(error),
      });
    } finally {
      if (!wasBusy) setBusyAction(null);
    }
  };

  const verifyFactor = async () => {
    const factorId = enrollment?.factorId ?? selectedFactorId;
    if (!factorId || !/^\d{6}$/.test(code.trim())) {
      toast({
        variant: "destructive",
        title: isPhoneFlow ? "Enter the code we texted you" : "Enter a valid authenticator code",
        description: isPhoneFlow
          ? "Use the 6-digit code from the most recent text message."
          : "Use the 6-digit code currently shown by your authenticator app.",
      });
      return;
    }

    setBusyAction("verify");
    try {
      if (isPhoneFlow) {
        if (challenge?.factorId !== factorId) {
          throw new Error("Request a new text-message code before verifying.");
        }
        const { error } = await supabase.auth.mfa.verify({
          factorId,
          challengeId: challenge.challengeId,
          code: code.trim(),
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.mfa.challengeAndVerify({
          factorId,
          code: code.trim(),
        });
        if (error) throw error;
      }
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;
      setEnrollment(null);
      setChallenge(null);
      setPhoneEntry(null);
      setCode("");
      await loadSecurityState();
      await queryClient.invalidateQueries({ queryKey: ["my_mfa_policy"] });
      toast({
        title: isPhoneFlow ? "Phone verified" : "Authenticator verified",
        description: "This session now meets the AAL2 security requirement.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Verification failed",
        description: describeMfaError(error),
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
        // Same teardown as every other sign-out: a forced one still has to drop the impersonation
        // record, the query cache, and the cached Supabase responses.
        await clearLocalSessionState();
        throw new Error("The factor was removed, but session assurance could not be refreshed. You were signed out for safety.");
      }
      if (enrollment?.factorId === factorId) setEnrollment(null);
      if (challenge?.factorId === factorId) setChallenge(null);
      setCode("");
      await loadSecurityState();
      await queryClient.invalidateQueries({ queryKey: ["my_mfa_policy"] });
      toast({ title: "Factor removed" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't remove factor",
        description: describeMfaError(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const selectFactorForStepUp = (factor: MfaFactor) => {
    setSelectedFactorId(factor.id);
    setEnrollment(null);
    setChallenge(null);
    setPhoneEntry(null);
    setCode("");
    if (factor.factor_type === "phone") void sendSmsCode(factor.id);
  };

  if (loading) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading account security" />
      </div>
    );
  }

  const showCodeForm = enrollment || (verifiedFactors.length > 0 && assurance.currentLevel !== "aal2");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Account security</p>
        <h1 className="text-3xl font-bold tracking-tight">Multi-factor authentication</h1>
        <p className="mt-2 text-muted-foreground">
          {smsAvailable
            ? "Protect privileged actions with a one-time code from your authenticator app or a text message."
            : "Protect privileged actions with a time-based one-time password from your authenticator app."}
        </p>
      </div>

      <Alert>
        {assurance.currentLevel === "aal2" ? <CheckCircle2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
        <AlertTitle>{assurance.currentLevel === "aal2" ? "Session verified at AAL2" : "Additional verification required"}</AlertTitle>
        <AlertDescription>
          {assurance.currentLevel === "aal2"
            ? "This browser session can perform protected enterprise administration actions."
            : assurance.nextLevel === "aal2"
              ? "Verify an enrolled factor before performing protected enterprise administration actions."
              : "Enroll a factor to enable protected enterprise administration actions."}
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Verification methods</CardTitle>
            <CardDescription>Each verified factor can be used to elevate a signed-in session to AAL2.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {factors.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                No verification method is enrolled for this account.
              </div>
            ) : (
              factors.map((factor) => (
                <div key={factor.id} className="flex items-center gap-3 rounded-lg border p-4">
                  {factor.factor_type === "phone"
                    ? <MessageSquare className="h-5 w-5 text-muted-foreground" />
                    : <KeyRound className="h-5 w-5 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{mfaFactorLabel(factor)}</p>
                    <p className="text-xs text-muted-foreground">
                      {factor.factor_type === "phone" ? "Text message" : "Authenticator app"}
                      {" · Added "}
                      {new Date(factor.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={factor.status === "verified" ? "default" : "outline"}>{factor.status}</Badge>
                  {factor.status === "verified" && assurance.currentLevel !== "aal2" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyAction !== null}
                      onClick={() => selectFactorForStepUp(factor)}
                    >
                      {factor.factor_type === "phone" ? "Text me a code" : "Verify"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${mfaFactorLabel(factor)}`}
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

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busyAction !== null || !!enrollment} onClick={() => void beginTotpEnrollment()}>
                {busyAction === "enroll" && phoneEntry === null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                Add authenticator app
              </Button>
              {smsAvailable ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyAction !== null || !!enrollment || phoneEntry !== null}
                  onClick={() => {
                    setPhoneEntry("");
                    setChallenge(null);
                    setCode("");
                  }}
                >
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Add text message (SMS)
                </Button>
              ) : null}
            </div>

            {smsAvailable && phoneEntry !== null && !enrollment ? (
              <form
                className="space-y-3 rounded-lg border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void beginPhoneEnrollment();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="mfa-phone">Mobile number</Label>
                  <Input
                    id="mfa-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phoneEntry}
                    onChange={(event) => setPhoneEntry(event.target.value)}
                    placeholder="(555) 123-4567"
                    disabled={busyAction !== null}
                  />
                  <p className="text-xs text-muted-foreground">
                    Standard message rates apply. Codes are sent only when you sign in to a protected workspace.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busyAction !== null || !phoneEntry.trim()}>
                    {busyAction === "enroll" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send verification code
                  </Button>
                  <Button type="button" variant="ghost" disabled={busyAction !== null} onClick={() => setPhoneEntry(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{enrollment ? "Finish enrollment" : "Verify this session"}</CardTitle>
            <CardDescription>
              {enrollment
                ? enrollment.factorType === "phone"
                  ? `Enter the code we texted to ${maskMfaPhone(enrollment.phone)}.`
                  : "Scan the QR code, then enter the current code."
                : "Enter a code from a verified method."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {enrollment?.factorType === "totp" ? (
              <div className="space-y-3">
                <div className="flex justify-center rounded-lg bg-white p-3">
                  <img src={enrollment.qrCode} alt="Authenticator enrollment QR code" className="h-48 w-48" />
                </div>
                <div>
                  <p className="text-sm font-medium leading-none">Manual setup key</p>
                  <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">{enrollment.secret}</code>
                </div>
              </div>
            ) : verifiedFactors.length === 0 && !enrollment ? (
              <p className="text-sm text-muted-foreground">Add a verification method to begin.</p>
            ) : assurance.currentLevel === "aal2" ? (
              <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
                This session is already verified. You may return to the enterprise control plane.
              </div>
            ) : null}

            {showCodeForm ? (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void verifyFactor();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="mfa-code">{isPhoneFlow ? "Text message code" : "Authenticator code"}</Label>
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
                  {isPhoneFlow && awaitingSms ? (
                    <p className="text-xs text-muted-foreground">Request a code to continue.</p>
                  ) : null}
                </div>
                <Button type="submit" className="w-full" disabled={busyAction !== null || !selectedFactorId || (isPhoneFlow && awaitingSms)}>
                  {busyAction === "verify" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isPhoneFlow ? "Verify text message code" : "Verify authenticator"}
                </Button>
                {isPhoneFlow && selectedFactorId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    disabled={busyAction !== null}
                    onClick={() => void sendSmsCode(selectedFactorId)}
                  >
                    {busyAction === "send-code" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {awaitingSms ? "Send a code" : "Send a new code"}
                  </Button>
                ) : null}
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
