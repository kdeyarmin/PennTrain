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

type LinkState = "checking" | "valid" | "invalid";

export default function ResetPassword() {
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
    // or after this effect runs, so check the current session AND keep listening.
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) {
        sessionEstablishedRef.current = true;
        setLinkState("valid");
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
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
        void supabase.auth.signOut();
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
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500/[0.03] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

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
          55 Pa. Code Chapter 2600 Compliance Platform
        </p>
      </div>
    </div>
  );
}
