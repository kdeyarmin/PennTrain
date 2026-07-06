import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useLocation } from "wouter";
import { supabase, clearSupabaseRuntimeCache } from "./supabase";
import { queryClient } from "./queryClient";
import { isPublicPath } from "./publicPaths";
import { useToast } from "@/hooks/use-toast";

export type Role = "platform_admin" | "org_admin" | "facility_manager" | "trainer" | "employee" | "auditor";

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isActive: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  hasRole: () => false,
});

// Centralized role check -- prefer this (or the useAuth().hasRole shortcut)
// over inline `user.role === "..."` comparisons in new code. This is a UX
// convenience only; Postgres RLS is the real authorization boundary.
export function hasRole(user: AuthUser | null, ...roles: Role[]): boolean {
  return !!user && roles.includes(user.role);
}

// The Supabase session itself lives in localStorage, shared by every tab/window of the browser,
// so a PASSWORD_RECOVERY marker kept only as in-memory React state would be invisible to a second
// tab (or the same tab after a hard refresh, once the URL hash has already been consumed) -- both
// would see the still-valid recovery session via getSession() with no idea it's a recovery
// session, and land the visitor straight in the target account's dashboard. Mirroring the marker
// into localStorage, keyed to the recovery session's user id, makes it visible everywhere the
// underlying session is visible -- including a DIFFERENT tab that receives the very same SIGNED_IN
// event via supabase-js's own cross-tab BroadcastChannel relay (that tab's own module-level
// `pendingImplicitGrantType` below reflects THAT tab's own URL, not the tab that actually opened
// the recovery/invite link, so it can't be relied on there -- the shared marker is what makes that
// tab recognize the session correctly too). A JSON *array* of user ids, not a single value: two
// different accounts' recovery/invite links opened concurrently in two tabs must not clobber each
// other's marker.
const RECOVERY_SESSION_KEY = "cmt-recovery-user-ids";

function getRecoveryUserIds(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECOVERY_SESSION_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function isKnownRecoverySession(session: Session | null): boolean {
  return !!session && getRecoveryUserIds().includes(session.user.id);
}

function markRecoverySession(userId: string) {
  const ids = getRecoveryUserIds();
  if (!ids.includes(userId)) {
    window.localStorage.setItem(RECOVERY_SESSION_KEY, JSON.stringify([...ids, userId]));
  }
}

// Removes only this one user id, so signing out of (or abandoning) one recovery/invite session
// doesn't clear a *different* one still pending in another tab.
function clearRecoverySession(userId: string | undefined) {
  if (!userId) return;
  const ids = getRecoveryUserIds().filter((id) => id !== userId);
  if (ids.length > 0) {
    window.localStorage.setItem(RECOVERY_SESSION_KEY, JSON.stringify(ids));
  } else {
    window.localStorage.removeItem(RECOVERY_SESSION_KEY);
  }
}

// An invite link lands here with `#access_token=...&type=invite` in the URL hash -- the same
// implicit-grant flow as password recovery (`type=recovery`), just a different `type`. GoTrue
// only fires the explicit PASSWORD_RECOVERY event for `type=recovery`; every other implicit-grant
// type, including `invite` (the only other one this app's invite-user Edge Function/`resetTo`
// actually produces), fires a plain SIGNED_IN. GoTrue parses this hash itself and doesn't clear it
// until its own /user round trip resolves -- well after this module evaluates -- so snapshotting
// it here, once, at first import (before that round trip has a chance to finish), lets
// resolveIsRecoverySession below recognize the session that actually corresponds to an invite
// redirect, even though by the time any event fires the hash itself is already gone.
//
// Consumed on the FIRST session-bearing check this tab makes, not tied to a specific event name.
// GoTrue always fires an INITIAL_SESSION event -- already carrying the freshly-established session
// -- strictly before the "real" SIGNED_IN/PASSWORD_RECOVERY notification it schedules a tick later
// for a URL-hash grant. Gating the read/clear on `event === "SIGNED_IN"` specifically would leave
// `session` (set unconditionally at the end of every branch below) pointing at the real invite
// session while `isRecoverySession` still defaults to its prior value during that earlier
// INITIAL_SESSION pass -- a real, if brief, window where isAuthenticated could read true before the
// deferred SIGNED_IN event arrives a tick later to correct it. Resolving through this single
// function on every event (see resolveIsRecoverySession) closes that window: isRecoverySession is
// derived atomically alongside `session` for every event, including the first one.
let pendingImplicitGrantType: string | null = new URLSearchParams(
  window.location.hash.replace(/^#/, ""),
).get("type");

// Single source of truth for "is this session a not-yet-confirmed recovery/invite session."
// Called for every session this tab observes (the initial getSession() read, and every
// onAuthStateChange event except SIGNED_OUT) so it's reached regardless of which specific event
// first carries the session, and regardless of whether that event was raised by an implicit-grant
// URL this tab itself loaded or relayed from another tab via supabase-js's cross-tab broadcast.
function resolveIsRecoverySession(session: Session | null): boolean {
  if (session && (pendingImplicitGrantType === "invite" || pendingImplicitGrantType === "recovery")) {
    pendingImplicitGrantType = null;
    markRecoverySession(session.user.id);
    return true;
  }
  return isKnownRecoverySession(session);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  // A PASSWORD_RECOVERY event means this session was minted from a reset/invite link, not a real
  // login -- only ResetPassword.tsx is allowed to use it. Until the visitor finishes (or abandons)
  // that flow, it must not count as "signed in" anywhere else, or opening someone else's reset
  // link would land the visitor straight in that person's dashboard.
  const [isRecoverySession, setIsRecoverySession] = useState(false);
  // Mirrors `session` so SIGNED_OUT (whose own nextSession is always null) can still identify and
  // clear precisely the one recovery/invite user id that belonged to the session that just ended,
  // without touching a *different* account's recovery marker some other tab may have pending.
  const lastSessionRef = useRef<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      lastSessionRef.current = data.session;
      setSession(data.session);
      setIsRecoverySession(resolveIsRecoverySession(data.session));
      setSessionLoading(false);
    });

    // Every event except SIGNED_OUT resolves isRecoverySession the same way, through
    // resolveIsRecoverySession -- which also handles PASSWORD_RECOVERY (the `recovery` implicit-
    // grant type resolves through the same pendingImplicitGrantType snapshot as `invite` does) and
    // a relayed SIGNED_IN from another tab (its fallback to the shared, cross-tab
    // RECOVERY_SESSION_KEY marker catches that automatically). An ordinary interactive login
    // (Login/Signup/Demo, all via supabase.auth.signInWithPassword) resolves false here without
    // needing its own special case, since isKnownRecoverySession can never match a session that
    // was never marked. SIGNED_OUT is the only event that should ever clear an established marker.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        clearRecoverySession(lastSessionRef.current?.user.id);
        setIsRecoverySession(false);
      } else {
        setIsRecoverySession(resolveIsRecoverySession(nextSession));
      }
      lastSessionRef.current = nextSession;
      setSession(nextSession);
      if (event === "SIGNED_IN") {
        queryClient.clear();
      } else {
        queryClient.invalidateQueries({ queryKey: ["profile"] });
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, [queryClient]);

  const { data: profile, isLoading: profileLoading, isError } = useQuery({
    queryKey: ["profile", session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session!.user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!session,
    retry: false,
  });

  const isLoading = sessionLoading || (!!session && profileLoading);
  const isAuthenticated = !!session && !!profile && profile.is_active && !isRecoverySession;

  const user: AuthUser | null = profile
    ? {
        id: profile.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        email: profile.email,
        role: profile.role as Role,
        organizationId: profile.organization_id,
        isActive: profile.is_active,
      }
    : null;

  useEffect(() => {
    if (!isLoading && !session && !isError) {
      if (!isPublicPath(window.location.pathname)) {
        setLocation("/login");
      }
    }
  }, [isLoading, session, isError, setLocation]);

  // A deactivated profile still has a valid Supabase session -- isAuthenticated above already
  // treats that as signed out, but the session itself needs to be torn down too, or the very
  // next getSession()/onAuthStateChange tick would let RLS-scoped reads resume as soon as an
  // admin reactivates them without the user needing to sign back in.
  useEffect(() => {
    if (!profile || profile.is_active) return;
    (async () => {
      await supabase.auth.signOut();
      queryClient.clear();
      toast({
        variant: "destructive",
        title: "Account deactivated",
        description: "Your account has been deactivated. Contact your administrator for access.",
      });
      setLocation("/login");
    })();
  }, [profile, queryClient, toast, setLocation]);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAuthenticated, hasRole: (...roles) => hasRole(user, ...roles) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Shared by every sign-out affordance (header user menu, sidebar user menu, ...)
// so they all clear cached query data and land on /login the same way.
export function useSignOut() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  return async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({ variant: "destructive", title: "Sign out failed", description: error.message });
    }
    queryClient.clear();
    await clearSupabaseRuntimeCache();
    setLocation("/login");
  };
}
