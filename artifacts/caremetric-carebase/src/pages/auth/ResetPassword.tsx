import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthBackground } from "@/components/auth/AuthBackground";
import { useToast } from "@/hooks/use-toast";
import { supabase, clearSupabaseRuntimeCache } from "@/lib/supabase";
import { Loader2, ShieldCheck, ArrowLeft, KeyRound, CheckCircle2 } from "lucide-react";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

type LinkState = "checking" | "valid" | "invalid";

// The reset/invite link lands with `#access_token=...&type=recovery` (or `type=invite`) in the
// URL hash -- or, when GoTrue already refused the token (expired, reused), with
// `#error=...&error_code=otp_expired` instead. supabase-js consumes the hash itself once its
// parse settles, so snapshot it at module evaluation, the same way auth.tsx snapshots its
// implicit-grant type. Consumed one-shot on mount below: a later remount of this page (in-app
// back/forward) must not treat a long-gone link hash as though that visit came from the email.
let pendingLinkHash: URLSearchParams | null = new URLSearchParams(
  window.location.hash.replace(/^#/, ""),
);

// auth.tsx's cross-tab recovery marker (RECOVERY_SESSION_KEY there): the user ids whose live
// session was minted from a reset/invite link rather than a real sign-in. auth.tsx owns the
// writes; reading it here lets this page still recognize the recovery session after the hash is
// gone -- this chunk loads lazily, often after supabase-js has consumed and cleared it.
function isMarkedRecoveryUser(userId: string): boolean {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem("cmt-recovery-user-ids") ?? "[]");
    return Array.isArray(parsed) && parsed.includes(userId);
  } catch {
    return false;
  }
}

export default function ResetPassword() {
  usePageMeta({ ...MARKETING_ROUTE_META["/reset-password"], path: "/reset-password" });
  const { toast } = useToast();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // Whether a recovery session actually got established, and whether the visitor finished the
  // reset -- used on unmount below to sign out of an abandoned recovery session so navigating
  // away (URL edit, back button, bookmark) doesn't leave it usable elsewhere in the app.
  const sessionEstablishedRef = useRef(false);
  const completedRef = useRef(false);

  useEffect(() => {
    // The recovery link lands here with tokens in the URL hash; supabase-js parses them
    // automatically (detectSessionInUrl defaults to true) and establishes a temporary
    // recovery session, firing a PASSWORD_RECOVERY auth event. That can happen either before
    // or after this effect runs, so check the current session AND keep listening. A session by
    // itself proves nothing, though -- the visitor may simply already be signed in, and treating
    // that session as the link's would show the form for an expired link (updateUser would then
    // rewrite the signed-in account's password) and make the abandonment cleanup below sign the
    // visitor out for merely opening the page. Only a session this page can tie to the link
    // counts: the hash's implicit-grant type, the PASSWORD_RECOVERY event, or auth.tsx's marker.
    let cancelled = false;

    const hash = pendingLinkHash;
    pendingLinkHash = null;
    const cameFromLink = hash?.get("type") === "recovery" || hash?.get("type") === "invite";

    if (hash?.get("error") || hash?.get("error_code")) {
      // GoTrue rejected the token outright, so no recovery session is coming -- say so now
      // rather than waiting out the timeout.
      setLinkState("invalid");
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session && (cameFromLink || isMarkedRecoveryUser(data.session.user.id))) {
        sessionEstablishedRef.current = true;
        setLinkState("valid");
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (
        event === "PASSWORD_RECOVERY" ||
        (event === "SIGNED_IN" && session && (cameFromLink || isMarkedRecoveryUser(session.user.id)))
      ) {
        sessionEstablishedRef.current = true;
        setLinkState("valid");
      }
    });

    // Give the URL-hash parse a moment before concluding the link is invalid/expired.
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setLinkState((current) => (current === "checking" ? "invalid" : current));
      }
    }, 2500);

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
      clearTimeout(timeout);
      if (sessionEstablishedRef.current && !completedRef.current) {
        // Local scope: tear down the abandoned recovery session in this tab without revoking
        // the account's refresh tokens everywhere else.
        void supabase.auth.signOut({ scope: "local" });
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ variant: "destructive", title: "Password too short", description: "Use at least 8 characters." });
      return;
    }
    if (password !== confirmPassword) {
      toast({ variant: "destructive", title: "Passwords don't match" });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      completedRef.current = true;
      setDone(true);
      // Sign out of the temporary recovery session so the user logs in fresh with the new
      // password, rather than silently landing in the app on a token meant only for this reset.
      await supabase.auth.signOut();
      await clearSupabaseRuntimeCache();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't update password",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden">
      <AuthBackground />

      <div className="w-full max-w-[420px] space-y-8 relative z-10 px-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="h-14 w-14 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
            <ShieldCheck className="h-7 w-7 text-primary-foreground" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-bold tracking-tight text-foreground">CareMetric CareBase</h1>
            <p className="text-sm text-muted-foreground">Healthcare Learning &amp; Compliance Platform</p>
          </div>
        </div>

        <Card className="border-border/50 shadow-xl shadow-black/[0.04] ring-1 ring-primary/10 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Set your password</CardTitle>
            <CardDescription>
              {linkState === "invalid"
                ? "This link is invalid or has expired."
                : done
                ? "Your password has been updated."
                : "Choose a password for your account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {linkState === "checking" ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : linkState === "invalid" ? (
              <div className="text-center py-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Request a new link and try again.
                </p>
                <Link href="/forgot-password">
                  <Button className="w-full">Request a new link</Button>
                </Link>
              </div>
            ) : done ? (
              <div className="text-center py-4 space-y-4">
                <div className="flex justify-center">
                  <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                  </div>
                </div>
                <Link href="/login">
                  <Button className="w-full">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to sign in
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-[13px] font-medium">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    className="h-10"
                    minLength={8}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-[13px] font-medium">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={submitting}
                    className="h-10"
                    minLength={8}
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-10 font-medium shadow-sm" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <KeyRound className="mr-2 h-4 w-4" />
                      Update password
                    </>
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60">
          55 Pa. Code Chapters 2600 &amp; 2800 Compliance Platform
        </p>
      </div>
    </div>
  );
}
