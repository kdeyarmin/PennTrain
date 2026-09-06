import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { KeyRound, Loader2, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { markExplicitPasswordSignIn, markIdleUnlockSignIn, useAuth, useSignOut } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useGetOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { PRIVILEGED_SESSION_EXPIRED_MESSAGE } from "@/lib/edgeFunctionErrors";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

/**
 * The server's own answer to "is this session locked", shared with MainLayout.
 *
 * It has to be shared because `current_org_id()` is `... and public.current_session_unlocked()`:
 * a locked session and a suspended organization are indistinguishable to any RLS-scoped read, so
 * the shell's suspension probe cannot be trusted until this has answered. Same query key, so the
 * two callers are one request.
 */
export function useCurrentIdleSessionLock(userId: string | undefined) {
  return useQuery({
    queryKey: ["current_idle_session_lock", userId],
    enabled: !!userId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_current_idle_session_lock");
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
  });
}

interface StepUpFactor {
  id: string;
  factorType: string;
  friendlyName: string | null;
}

export function IdleSessionLock({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const signOut = useSignOut();
  const settings = useGetOrganizationSettings(user?.organizationId ?? undefined);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [lockEventId, setLockEventId] = useState<string | null>(null);
  // The second half of an unlock, when the account carries a verified factor: the password bought
  // a NEW Auth session and a new session starts at AAL1, so re-verifying happens here rather than
  // by handing the user to /account/security -- which would unmount the route this overlay
  // promises to keep.
  const [stepUpFactors, setStepUpFactors] = useState<StepUpFactor[] | null>(null);
  const [stepUpFactorId, setStepUpFactorId] = useState<string | null>(null);
  const [stepUpChallengeId, setStepUpChallengeId] = useState<string | null>(null);
  const [stepUpCode, setStepUpCode] = useState("");
  const lastActivity = useRef(Date.now());
  const persistedLock = useCurrentIdleSessionLock(user?.id);

  useEffect(() => {
    if (!persistedLock.data) return;
    setLockEventId(persistedLock.data);
    setLocked(true);
  }, [persistedLock.data]);

  const isKiosk = location.includes("/kiosk") || location.startsWith("/checkin/");
  const timeoutMinutes = isKiosk
    ? settings.data?.kiosk_idle_timeout_minutes ?? 5
    : settings.data?.idle_timeout_minutes ?? 30;

  const lock = useCallback(() => {
    if (locked || !user) return;
    setLocked(true);
    setPassword("");
    void supabase.rpc("record_idle_session_lock", {
      p_route_path: location,
      p_lock_reason: isKiosk ? "kiosk_timeout" : "idle_timeout",
    }).then(({ data }) => { if (typeof data === "string") setLockEventId(data); });
  }, [isKiosk, location, locked, user]);

  useEffect(() => {
    const markActivity = () => { if (!locked) lastActivity.current = Date.now(); };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, markActivity, { passive: true });
    const interval = window.setInterval(() => {
      if (!locked && Date.now() - lastActivity.current >= timeoutMinutes * 60_000) lock();
    }, 10_000);
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, markActivity);
      window.clearInterval(interval);
    };
  }, [lock, locked, timeoutMinutes]);

  // Everything that dismisses the overlay, in the one order that keeps its promise: close the
  // server-side lock first (record_idle_session_unlock is what makes current_session_unlocked()
  // true again, and every RLS-scoped read under this overlay depends on it), then let the MFA gate
  // above re-read the policy against the session we have just finished raising back to AAL2.
  const finishUnlock = async () => {
    if (lockEventId) await supabase.rpc("record_idle_session_unlock", { p_lock_event_id: lockEventId });
    // This one is no longer swept by the SIGNED_IN cache clear (see markIdleUnlockSignIn), so it
    // has to be refreshed explicitly -- a remount reading the stale lock id back out of the cache
    // would re-lock a session that is now demonstrably unlocked.
    await queryClient.invalidateQueries({ queryKey: ["current_idle_session_lock"] });
    await queryClient.invalidateQueries({ queryKey: ["my_mfa_policy"] });
    setLocked(false);
    setLockEventId(null);
    setPassword("");
    setStepUpFactors(null);
    setStepUpFactorId(null);
    setStepUpChallengeId(null);
    setStepUpCode("");
    lastActivity.current = Date.now();
  };

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !password) return;
    setUnlocking(true);
    try {
      // Two markers, two different jobs. markExplicitPasswordSignIn proves this is a real login
      // for this account (it clears a stale recovery marker); markIdleUnlockSignIn tells the auth
      // listener NOT to clear the react-query cache for this one SIGNED_IN. Without the second,
      // the banner's "without losing the current page" was false twice over: the cache clear put
      // both gates back into their loading spinners, which unmounts the route and takes unsaved
      // form state with it.
      markIdleUnlockSignIn();
      markExplicitPasswordSignIn();
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
      if (error) throw error;

      // signInWithPassword mints a NEW session, and a new session is AAL1 no matter what the old
      // one held. `nextLevel` is the account's own bar: aal2 means a verified factor exists, so
      // the session that was locked was aal2 and this one has to get back there before the
      // overlay comes down -- otherwise the unlock silently downgrades the session while
      // MfaPolicyGate, reading its cached answer, keeps the workspace open.
      const { data: assurance, error: assuranceError } = await supabase.auth.mfa
        .getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
        const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors();
        if (factorError) throw factorError;
        const verified = (factorData?.all ?? [])
          .filter((factor) => factor.status === "verified")
          .map((factor) => ({
            id: factor.id,
            factorType: factor.factor_type,
            friendlyName: factor.friendly_name ?? null,
          }));
        if (verified.length > 0) {
          setStepUpFactors(verified);
          setStepUpFactorId(verified[0].id);
          setStepUpChallengeId(null);
          setStepUpCode("");
          setPassword("");
          return;
        }
      }
      await finishUnlock();
    } catch (error) {
      toast({ title: "Could not unlock session", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setUnlocking(false);
    }
  };

  const selectedStepUpFactor = stepUpFactors?.find((factor) => factor.id === stepUpFactorId) ?? null;
  const isPhoneStepUp = selectedStepUpFactor?.factorType === "phone";

  const sendStepUpCode = async () => {
    if (!stepUpFactorId) return;
    setUnlocking(true);
    try {
      const { data, error } = await supabase.auth.mfa.challenge({ factorId: stepUpFactorId });
      if (error) throw error;
      setStepUpChallengeId(data.id);
      toast({ title: "Code sent", description: "Enter the 6-digit code from the text message." });
    } catch (error) {
      toast({ title: "Could not send a code", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setUnlocking(false);
    }
  };

  const verifyStepUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stepUpFactorId || !/^\d{6}$/.test(stepUpCode.trim())) return;
    setUnlocking(true);
    try {
      if (isPhoneStepUp) {
        if (!stepUpChallengeId) throw new Error("Request a new text-message code before verifying.");
        const { error } = await supabase.auth.mfa.verify({
          factorId: stepUpFactorId, challengeId: stepUpChallengeId, code: stepUpCode.trim(),
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.mfa.challengeAndVerify({
          factorId: stepUpFactorId, code: stepUpCode.trim(),
        });
        if (error) throw error;
      }
      // Same reason MfaSettings refreshes here: the `aal` claim is minted into the access token,
      // so without this the session is verified and the JWT still says aal1.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;
      await finishUnlock();
    } catch (error) {
      toast({ title: "Verification failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setUnlocking(false);
    }
  };

  if (user && persistedLock.isLoading) {
    return <div className="grid min-h-screen place-items-center bg-background" role="status">
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
      <span className="sr-only">Checking session security</span>
    </div>;
  }

  // Fail closed when the lock check itself fails. Rendering children here would let a refresh
  // during an existing lock bypass the overlay whenever the RPC is unavailable.
  if (user && persistedLock.isError) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-destructive/10">
              <LockKeyhole className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Session security unavailable</CardTitle>
            <CardDescription>
              CareBase could not verify whether this session is locked. Retry the check, or sign out.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => void persistedLock.refetch()}>Retry</Button>
            <Button variant="ghost" onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" />Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {children}
      {locked && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/95 px-4" role="dialog" aria-modal="true" aria-labelledby="session-lock-title">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center"><div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-primary/10"><LockKeyhole className="h-6 w-6 text-primary" /></div><CardTitle id="session-lock-title">{stepUpFactors ? "One more step" : "Session locked"}</CardTitle><CardDescription>{stepUpFactors
              ? "Your password was accepted. Unlocking starts a new sign-in session, so verify your second factor to finish -- the page behind this is still exactly where you left it."
              : `This shared-device session was locked after ${timeoutMinutes} minutes without activity. Re-enter your password to continue without losing the current page.`}</CardDescription></CardHeader>
            <CardContent>{stepUpFactors ? (
              <form onSubmit={verifyStepUp} className="space-y-4">
                {stepUpFactors.length > 1 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="unlock-factor">Verification method</Label>
                    <select
                      id="unlock-factor"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={stepUpFactorId ?? ""}
                      onChange={(event) => { setStepUpFactorId(event.target.value); setStepUpChallengeId(null); setStepUpCode(""); }}
                    >
                      {stepUpFactors.map((factor) => (
                        <option key={factor.id} value={factor.id}>
                          {factor.friendlyName ?? (factor.factorType === "phone" ? "Text message" : "Authenticator app")}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {isPhoneStepUp && (
                  <Button className="w-full" variant="outline" type="button" disabled={unlocking} onClick={() => void sendStepUpCode()}>
                    {stepUpChallengeId ? "Send a new code" : "Text me a code"}
                  </Button>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="unlock-code">6-digit code</Label>
                  <Input id="unlock-code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={stepUpCode} onChange={(event) => setStepUpCode(event.target.value.replace(/\D/g, ""))} />
                </div>
                <Button className="w-full" type="submit" disabled={unlocking || !/^\d{6}$/.test(stepUpCode.trim()) || (isPhoneStepUp && !stepUpChallengeId)}>
                  <ShieldCheck className="mr-2 h-4 w-4" />{unlocking ? "Verifying…" : "Verify and continue"}
                </Button>
                <Button className="w-full" variant="ghost" type="button" onClick={() => void signOut()}><LogOut className="mr-2 h-4 w-4" />Sign out instead</Button>
              </form>
            ) : (
              <form onSubmit={unlock} className="space-y-4"><div className="space-y-1.5"><Label htmlFor="unlock-email">Account</Label><Input id="unlock-email" value={user?.email ?? ""} disabled /></div><div className="space-y-1.5"><Label htmlFor="unlock-password">Password</Label><Input id="unlock-password" type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div><Button className="w-full" type="submit" disabled={unlocking || !password}><KeyRound className="mr-2 h-4 w-4" />{unlocking ? "Unlocking…" : "Unlock session"}</Button><Button className="w-full" variant="ghost" type="button" onClick={() => void signOut()}><LogOut className="mr-2 h-4 w-4" />Sign out instead</Button></form>
            )}</CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

export function MfaPolicyGate({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const signOut = useSignOut();
  const policy = useQuery({
    queryKey: ["my_mfa_policy"],
    queryFn: async () => {
      const [
        { data: requirement, error: requirementError },
        { data: assurance, error: assuranceError },
        { data: assuranceIsCurrent, error: freshnessError },
      ] = await Promise.all([
        supabase.rpc("get_my_mfa_policy"),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        // Granted to `authenticated` (20260711200637), and the same call the Edge Functions make
        // through _shared/privilegedIdentity.ts. It answers true whenever the operation does not
        // require AAL2 for this caller at all, so asking it costs nothing for an unprivileged
        // session and is the only way the shell can see the window that has actually closed.
        supabase.rpc("identity_assurance_is_current", { p_operation: "identity_admin" }),
      ]);
      if (requirementError) throw requirementError;
      if (assuranceError) throw assuranceError;
      if (freshnessError) throw freshnessError;
      return {
        requirement: requirement as { required: boolean; maxSessionMinutes?: number },
        assurance,
        assuranceIsCurrent: assuranceIsCurrent === true,
      };
    },
    staleTime: 60_000,
    // The privileged window closes on a clock, not on an action, so the shell has to look again
    // to be able to say so. Paused while the tab is hidden (react-query's default), and both RPCs
    // are single-row reads.
    refetchInterval: 5 * 60_000,
  });

  // Enrollment and step-up live on this route; the gate must never block it, including while the
  // policy query is still loading or has failed.
  if (location === "/account/security") return children;

  // Fail closed while loading and after errors. `mustVerify` used to be false whenever data was
  // absent, so privileged workspaces rendered during the initial request and permanently after any
  // RPC/MFA failure.
  if (policy.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background" role="status">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <span className="sr-only">Checking multi-factor policy</span>
      </div>
    );
  }

  if (policy.isError) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <ShieldCheck className="mx-auto mb-2 h-10 w-10 text-primary" />
            <CardTitle role="heading" aria-level={1}>Multi-factor policy unavailable</CardTitle>
            <CardDescription>
              CareBase could not confirm whether your organization requires a second verification
              step. Retry the check, open account security, or sign out.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => void policy.refetch()}>Retry</Button>
            <Button asChild variant="outline"><Link href="/account/security">Open account security</Link></Button>
            <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const mustVerify = policy.data?.requirement.required && policy.data.assurance.currentLevel !== "aal2";

  // The gate's blind spot, and the reason `maxSessionMinutes` sat on this type unread: the JWT
  // really is aal2, so `mustVerify` is false and the workspace opens -- while every RPC guarded by
  // assert_identity_assurance answers 42501, and every policy-document RLS predicate filters the
  // row out so an UPDATE matches nothing and returns PGRST116 instead. A manager who signed in
  // yesterday held yesterday's auth.sessions row (Supabase sessions do not expire on their own),
  // and past max_privileged_session_minutes the whole privileged half of the product refused with
  // nothing on screen to explain it. Only a NEW session clears it, which is why the one control
  // here is Sign out.
  const privilegedWindowClosed = policy.data?.requirement.required
    && !mustVerify
    && !policy.data.assuranceIsCurrent;
  if (privilegedWindowClosed) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <ShieldCheck className="mx-auto mb-2 h-10 w-10 text-primary" />
            <CardTitle role="heading" aria-level={1}>Sign in again to continue</CardTitle>
            <CardDescription>{PRIVILEGED_SESSION_EXPIRED_MESSAGE}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" />Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!mustVerify) return children;
  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      {/* A real heading role: CardTitle renders a div, which left this full-screen gate invisible to
          assistive tech (and to any instrumentation that asks "did a page render") -- a signed-in
          admin's first screen deserves to announce itself. */}
      <Card className="w-full max-w-lg"><CardHeader className="text-center"><ShieldCheck className="mx-auto mb-2 h-10 w-10 text-primary" /><CardTitle role="heading" aria-level={1}>Multi-factor verification required</CardTitle><CardDescription>Your organization requires administrators and managers to use a second verification step. Enroll or verify a factor -- an authenticator app, or a code texted to your phone -- before opening protected workspaces.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2"><Button asChild><Link href="/account/security">Open account security</Link></Button><Button variant="ghost" onClick={() => void signOut()}>Sign out</Button></CardContent></Card>
    </div>
  );
}
