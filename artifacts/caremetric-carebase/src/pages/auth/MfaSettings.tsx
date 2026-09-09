import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
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
  maskMfaPhone,
  mfaFactorLabel,
  normalizeMfaPhone,
  type MfaFactor,
  type MfaFactorType,
} from "@/lib/mfaFactors";
import {
  loadMfaSecurityState as fetchMfaSecurityState,
  invalidateMfaDependentQueries,
  mfaStatusIsVerified,
  sendSmsMfaCode,
  verifySmsMfaCode,
  usableMfaFactors,
  type MfaStatus,
} from "@/lib/mfaSecurity";
import { sanitizePostLoginPath } from "@/lib/loginRedirect";
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Loader2, LockKeyhole, MessageSquare, ShieldCheck, Trash2 } from "lucide-react";

type Enrollment = {
  factorId: string;
  factorType: MfaFactorType;
  qrCode?: string;
  secret?: string;
  phone?: string;
};

/** A phone factor can only be verified against a challenge that actually sent a code. */
type PendingChallenge = {
  factorId: string;
  challengeId: string;
};

export default function MfaSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const search = useSearch();
  const [smsAvailable, setSmsAvailable] = useState(false);
  // BACKLOG J74 (P3, identity). This page was a dead end: whether you arrived from the header
  // menu, the sidebar, or the MFA wall standing in front of a deep link, there was no control on
  // it that went anywhere. MfaPolicyGate now forwards the blocked route as ?next=; everything else
  // falls back to the app root so there is always a way out.
  const returnPath = useMemo(() => {
    const raw = new URLSearchParams(search).get("next");
    const sanitized = sanitizePostLoginPath(raw);
    return sanitized === "/account/security" ? "/" : sanitized;
  }, [search]);
  const hasDeepLink = returnPath !== "/";
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null);
  const [phoneEntry, setPhoneEntry] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadSecurityState = useCallback(async () => {
    const result = await fetchMfaSecurityState().catch((error: unknown) => {
      setStatus(null);
      setLoadError(describeMfaError(error));
      throw error;
    });
    const allFactors = result.factors;
    setFactors(allFactors);
    setStatus(result.status);
    setSmsAvailable(result.smsAvailable);
    setLoadError(null);
    setSelectedFactorId((current) => {
      const usable = usableMfaFactors(allFactors, result.status);
      if (current && (!result.status.smsRequired ? allFactors : usable).some((factor) => factor.id === current)) return current;
      return usable[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSecurityState()
      .catch((error) => {
        if (!cancelled) {
          setLoadError(describeMfaError(error));
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

  useEffect(() => {
    if (!status?.verified || !status.expiresAt) return;
    const expire = () => setStatus((current) => current ? { ...current, verified: false } : null);
    const delay = Date.parse(status.expiresAt) - Date.now();
    if (delay <= 0) { expire(); return; }
    const timer = window.setTimeout(expire, Math.min(delay + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [status?.verified, status?.expiresAt]);

  const verifiedFactors = useMemo(
    () => status ? usableMfaFactors(factors, status) : [],
    [factors, status],
  );

  const activeFactor = useMemo(() => {
    const activeId = enrollment?.factorId ?? selectedFactorId;
    return factors.find((factor) => factor.id === activeId) ?? null;
  }, [enrollment?.factorId, factors, selectedFactorId]);

  const activeFactorType: MfaFactorType = enrollment?.factorType ?? activeFactor?.factor_type ?? "totp";
  const isPhoneFlow = activeFactorType === "phone" || activeFactorType === "sms";
  /** SMS codes only exist once a challenge has been issued for the factor in play. */
  const awaitingSms = isPhoneFlow && challenge?.factorId !== (enrollment?.factorId ?? selectedFactorId);

  const beginTotpEnrollment = async () => {
    if (status?.smsRequired) return;
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
      const sent = await sendSmsMfaCode(phone);
      // Pending enrollment has no reusable factor until the server verifies this session's code.
      const pendingId = `sms-enrollment:${sent.challengeId}`;
      setEnrollment({ factorId: pendingId, factorType: "sms", phone: sent.maskedPhone });
      setSelectedFactorId(pendingId);
      setChallenge({ factorId: pendingId, challengeId: sent.challengeId });
      setCode("");
      toast({ title: "Verification code sent", description: `Enter the code sent to ${sent.maskedPhone}.` });
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
      const factor = factors.find((candidate) => candidate.id === factorId);
      if (factor?.factor_type === "phone") {
        const { data, error } = await supabase.auth.mfa.challenge({ factorId, channel: "sms" });
        if (error) throw error;
        setChallenge({ factorId, challengeId: data.id });
      } else {
        // Existing factors never accept a destination supplied by this browser.
        const sent = await sendSmsMfaCode(enrollment?.factorId === factorId ? normalizeMfaPhone(phoneEntry ?? "") ?? undefined : undefined);
        setChallenge({ factorId, challengeId: sent.challengeId });
      }
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
        if (activeFactorType === "sms") {
          await verifySmsMfaCode(challenge.challengeId, code.trim());
        } else {
          const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.challengeId, code: code.trim() });
          if (error) throw error;
        }
      } else {
        const { error } = await supabase.auth.mfa.challengeAndVerify({
          factorId,
          code: code.trim(),
        });
        if (error) throw error;
      }
      if (activeFactorType !== "sms") {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
      }
      setEnrollment(null);
      setChallenge(null);
      setPhoneEntry(null);
      setCode("");
      await invalidateMfaDependentQueries(queryClient);
      await loadSecurityState();
      toast({
        title: isPhoneFlow ? "Phone verified" : "Authenticator verified",
        description: "This session now meets the multi-factor security requirement.",
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
      const factor = factors.find((candidate) => candidate.id === factorId);
      if (factor?.factor_type === "sms" || status?.smsRequired) return;
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      // Native removal requires a new JWT; it is offered only for accounts without app SMS.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        await supabase.auth.signOut();
        await clearLocalSessionState();
        throw new Error("The factor was removed, but session assurance could not be refreshed. You were signed out for safety.");
      }
      if (enrollment?.factorId === factorId) setEnrollment(null);
      if (challenge?.factorId === factorId) setChallenge(null);
      setCode("");
      await invalidateMfaDependentQueries(queryClient);
      await loadSecurityState();
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
    if (status?.smsRequired && factor.factor_type !== "sms") return;
    setSelectedFactorId(factor.id);
    setEnrollment(null);
    setChallenge(null);
    setPhoneEntry(null);
    setCode("");
    if (factor.factor_type === "phone" || factor.factor_type === "sms") void sendSmsCode(factor.id);
  };

  if (loading) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading account security" />
      </div>
    );
  }

  if (loadError || !status) {
    return <Alert variant="destructive"><AlertTitle>Account security unavailable</AlertTitle><AlertDescription>{loadError ?? "The verification status could not be confirmed."}</AlertDescription><Button className="mt-3" onClick={() => { setLoading(true); void loadSecurityState().catch((error) => setLoadError(describeMfaError(error))).finally(() => setLoading(false)); }}>Retry</Button></Alert>;
  }

  const verifiedHere = mfaStatusIsVerified(status);
  const showCodeForm = enrollment || (verifiedFactors.length > 0 && !verifiedHere);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 px-2 text-muted-foreground"
        onClick={() => navigate(returnPath)}
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        {hasDeepLink ? "Back to the page you were opening" : "Back to CareBase"}
      </Button>
      <div>
        <p className="text-sm font-medium text-primary">Account security</p>
        <h1 className="text-3xl font-bold tracking-tight">Multi-factor authentication</h1>
        <p className="mt-2 text-muted-foreground">
          {status.smsRequired
            ? "Protect your account with a one-time code sent to your mobile number."
            : smsAvailable
              ? "Protect privileged actions with a one-time code from your authenticator app or a text message."
              : "Protect privileged actions with a time-based one-time password from your authenticator app."}
        </p>
      </div>

      <Alert>
        {verifiedHere ? <CheckCircle2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
        <AlertTitle>{verifiedHere ? "Session verified" : "Additional verification required"}</AlertTitle>
        <AlertDescription>
          {verifiedHere
            ? "This browser session can perform protected enterprise administration actions."
            : status.hasVerifiedFactor
              ? "Verify an enrolled factor before performing protected enterprise administration actions."
              : "Enroll a factor to enable protected enterprise administration actions."}
        </AlertDescription>
        {hasDeepLink && verifiedHere ? (
          <div className="mt-3">
            <Button type="button" size="sm" onClick={() => navigate(returnPath)}>
              Continue to the page you were opening
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </Alert>

      {status.smsRequired && !smsAvailable ? (
        <Alert><AlertTitle>Text-message service unavailable</AlertTitle><AlertDescription>CareBase could not confirm that text-message verification is available. Retry this page or contact your administrator.</AlertDescription><Button className="mt-3" variant="outline" onClick={() => void loadSecurityState().catch(() => undefined)}>Retry</Button></Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Verification methods</CardTitle>
            <CardDescription>Each verified method can protect a signed-in session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {factors.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                No verification method is enrolled for this account.
              </div>
            ) : (
              factors.map((factor) => (
                <div key={factor.id} className="flex items-center gap-3 rounded-lg border p-4">
                  {(factor.factor_type === "phone" || factor.factor_type === "sms")
                    ? <MessageSquare className="h-5 w-5 text-muted-foreground" />
                    : <KeyRound className="h-5 w-5 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{mfaFactorLabel(factor)}</p>
                    <p className="text-xs text-muted-foreground">
                      {(factor.factor_type === "phone" || factor.factor_type === "sms") ? "Text message" : "Authenticator app"}
                      {" · Added "}
                      {new Date(factor.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={factor.status === "verified" && (!status.smsRequired || factor.factor_type === "sms") ? "default" : "outline"}>{status.smsRequired && factor.factor_type !== "sms" ? "Not in use" : factor.status}</Badge>
                  {factor.status === "verified" && !verifiedHere && (!status.smsRequired || factor.factor_type === "sms") ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyAction !== null}
                      onClick={() => selectFactorForStepUp(factor)}
                    >
                      {(factor.factor_type === "phone" || factor.factor_type === "sms") ? "Text me a code" : "Verify"}
                    </Button>
                  ) : null}
                  {!status.smsRequired ? (
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
                  ) : null}
                </div>
              ))
            )}

            {status.smsRequired && status.smsFactors.length === 0 ? <p className="text-sm text-muted-foreground">Your text-message method was reset. Add a mobile number to restore access.</p> : null}
            {status.smsFactors.length > 0 ? <p className="text-sm text-muted-foreground">Text-message verification is active for this account. Verify a text code to continue. Contact your administrator if you lose access to this number.</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busyAction !== null || !!enrollment || status.smsRequired} onClick={() => void beginTotpEnrollment()}>
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
                  {status.smsFactors.length ? "Change mobile number" : "Add text message (SMS)"}
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
                  {status.smsRequired && status.smsFactors.length === 0 ? <p className="text-sm text-muted-foreground">Your text-message method was reset. Add a mobile number to restore access.</p> : null}
            {status.smsFactors.length > 0 ? <p className="text-sm text-muted-foreground">Verify your current text-message method and sign in recently with your password before changing this number.</p> : null}
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
                    By requesting a code, you agree to receive account security text messages at this number. Message and data rates may apply.
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
                ? enrollment.factorType !== "totp"
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
            ) : verifiedHere && !enrollment ? (
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
                {enrollment?.factorType === "sms" ? (
                  <Button type="button" variant="ghost" className="w-full" disabled={busyAction !== null} onClick={() => { setEnrollment(null); setChallenge(null); setSelectedFactorId(null); setCode(""); setPhoneEntry(""); }}>Use a different number</Button>
                ) : null}
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
