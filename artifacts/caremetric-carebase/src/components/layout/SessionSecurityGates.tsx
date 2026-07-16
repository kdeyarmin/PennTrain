import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { KeyRound, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { useAuth, useSignOut } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useGetOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

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
  const lastActivity = useRef(Date.now());

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

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !password) return;
    setUnlocking(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["my_mfa_policy"] });
      if (lockEventId) await supabase.rpc("record_idle_session_unlock", { p_lock_event_id: lockEventId });
      setLocked(false);
      setLockEventId(null);
      setPassword("");
      lastActivity.current = Date.now();
    } catch (error) {
      toast({ title: "Could not unlock session", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <>
      {children}
      {locked && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/95 px-4" role="dialog" aria-modal="true" aria-labelledby="session-lock-title">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center"><div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-primary/10"><LockKeyhole className="h-6 w-6 text-primary" /></div><CardTitle id="session-lock-title">Session locked</CardTitle><CardDescription>This shared-device session was locked after {timeoutMinutes} minutes without activity. Re-enter your password to continue without losing the current page.</CardDescription></CardHeader>
            <CardContent><form onSubmit={unlock} className="space-y-4"><div className="space-y-1.5"><Label htmlFor="unlock-email">Account</Label><Input id="unlock-email" value={user?.email ?? ""} disabled /></div><div className="space-y-1.5"><Label htmlFor="unlock-password">Password</Label><Input id="unlock-password" type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div><Button className="w-full" type="submit" disabled={unlocking || !password}><KeyRound className="mr-2 h-4 w-4" />{unlocking ? "Unlocking…" : "Unlock session"}</Button><Button className="w-full" variant="ghost" type="button" onClick={() => void signOut()}><LogOut className="mr-2 h-4 w-4" />Sign out instead</Button></form></CardContent>
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
      const [{ data: requirement, error: requirementError }, { data: assurance, error: assuranceError }] = await Promise.all([
        supabase.rpc("get_my_mfa_policy"),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (requirementError) throw requirementError;
      if (assuranceError) throw assuranceError;
      return { requirement: requirement as { required: boolean; maxSessionMinutes?: number }, assurance };
    },
    staleTime: 60_000,
  });
  const mustVerify = policy.data?.requirement.required && policy.data.assurance.currentLevel !== "aal2";
  if (!mustVerify || location === "/account/security") return children;
  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <Card className="w-full max-w-lg"><CardHeader className="text-center"><ShieldCheck className="mx-auto mb-2 h-10 w-10 text-primary" /><CardTitle>Multi-factor verification required</CardTitle><CardDescription>Your organization requires administrators and managers to use an authenticator. Enroll or verify a factor before opening protected workspaces.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2"><Button asChild><Link href="/account/security">Open account security</Link></Button><Button variant="ghost" onClick={() => void signOut()}>Sign out</Button></CardContent></Card>
    </div>
  );
}
