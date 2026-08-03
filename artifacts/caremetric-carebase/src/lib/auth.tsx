import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useLocation } from "wouter";
import { supabase, clearSupabaseRuntimeCache } from "./supabase";
import { queryClient } from "./queryClient";
import { isPublicPath } from "./publicPaths";
import { loginPathWithNext } from "./loginRedirect";
import { useToast } from "@/hooks/use-toast";
import { AuthProfileError } from "@/components/AuthProfileError";
import { isDefinitiveProfileAbsence } from "@/lib/authProfileErrors";
import { STORAGE_KEY as IMPERSONATION_STORAGE_KEY, CHANGE_EVENT as IMPERSONATION_CHANGE_EVENT } from "@/hooks/useImpersonation";
import { wipeOfflineServiceDrafts } from "@/lib/offlineServiceDraftCache";
import {
  isOfflineServiceDraftIdentityPending, shouldWipeOfflineServiceDraftData,
  type OfflineServiceDraftIdentitySnapshot,
} from "@/lib/offlineServiceDraftSafety";

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

function clearImpersonationSession() {
  sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
  window.dispatchEvent(new Event(IMPERSONATION_CHANGE_EVENT));
}

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

// Codex review finding: if a visitor opens a reset/invite link and then closes the tab (rather
// than navigating away within the app, which is what runs ResetPassword.tsx's own abandonment
// signOut()), the marker set above is never cleared -- it isn't tied to a timeout or to the
// specific link/token, only to the account's user id. The next time that SAME account signs in for
// real with their actual password, isKnownRecoverySession would still match and incorrectly keep
// isAuthenticated false, with no obvious way for the user to recover short of clearing storage.
//
// Login.tsx/Signup.tsx/Demo.tsx -- the only three places this app calls signInWithPassword --
// call markExplicitPasswordSignIn() immediately before doing so. Successfully authenticating with
// a password is the strongest possible proof this is a real login for that account, regardless of
// what any stale marker says, so the very next SIGNED_IN event (auth-js fires it synchronously as
// part of signInWithPassword's own call chain, before the caller's `await` resumes -- never
// INITIAL_SESSION, which only fires once on initial client load, not on a later interactive call)
// clears that account's marker rather than trusting it. The short expiry is just a backstop for a
// failed sign-in attempt (wrong password: no SIGNED_IN fires at all, so nothing consumes the flag)
// so a stale "expect a real login" flag can't linger indefinitely and wrongly bless some unrelated
// later SIGNED_IN in the same tab.
let explicitPasswordSignInExpiresAt = 0;
export function markExplicitPasswordSignIn() {
  explicitPasswordSignInExpiresAt = Date.now() + 15_000;
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
  // Last identity the offline service-documentation draft store (BACKLOG.md E5) was observed under.
  // Compared against the resolved profile below on every change, and against a bare logout in the
  // auth-state-change handler immediately following, so the wipe fires proactively either way rather
  // than waiting for the store to next be opened.
  const lastOfflineServiceDraftIdentityRef = useRef<OfflineServiceDraftIdentitySnapshot | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      lastSessionRef.current = data.session;
      setSession(data.session);
      setIsRecoverySession(resolveIsRecoverySession(data.session));
      setSessionLoading(false);
    });

    // Every event resolves isRecoverySession through resolveIsRecoverySession -- which also
    // handles PASSWORD_RECOVERY (the `recovery` implicit-grant type resolves through the same
    // pendingImplicitGrantType snapshot as `invite` does) and a relayed SIGNED_IN from another tab
    // (its fallback to the shared, cross-tab RECOVERY_SESSION_KEY marker catches that
    // automatically) -- except two events with their own explicit handling: SIGNED_OUT always
    // clears the marker (nothing to resolve, there's no session left), and a SIGNED_IN that
    // immediately followed markExplicitPasswordSignIn() is a just-confirmed real password login,
    // which overrides and clears even a stale, never-cleaned-up marker for this exact account (see
    // that function's own comment for why a marker can go stale in the first place).
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Only ever consumed here, on SIGNED_IN specifically -- never reset on some other,
      // unrelated event in between, for the same reason pendingImplicitGrantType above is only
      // consumed when actually checked: an earlier fix that cleared a similar one-shot flag
      // unconditionally on every event let an unrelated event consume it before the one it was
      // meant to gate ever arrived.
      const isConfirmedPasswordSignIn =
        event === "SIGNED_IN" && !!nextSession && Date.now() < explicitPasswordSignInExpiresAt;
      if (event === "SIGNED_IN") {
        explicitPasswordSignInExpiresAt = 0;
      }

      if (event === "SIGNED_OUT") {
        clearRecoverySession(lastSessionRef.current?.user.id);
        setIsRecoverySession(false);
        // Logout is the clearest possible identity-change signal, and does not need to wait for the
        // (now-disabled) profile query below to settle: wipe the offline service-documentation draft
        // store immediately.
        void wipeOfflineServiceDrafts();
        lastOfflineServiceDraftIdentityRef.current = null;
      } else if (isConfirmedPasswordSignIn) {
        clearRecoverySession(nextSession.user.id);
        setIsRecoverySession(false);
      } else {
        setIsRecoverySession(resolveIsRecoverySession(nextSession));
      }
      lastSessionRef.current = nextSession;
      setSession(nextSession);
      if (event === "SIGNED_IN") {
        void clearSupabaseRuntimeCache();
        queryClient.clear();
      } else {
        queryClient.invalidateQueries({ queryKey: ["profile"] });
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, [queryClient]);

  const {
    data: profile,
    error: profileError,
    isLoading: profileLoading,
    isFetching: profileFetching,
    isError,
    refetch: refetchProfile,
  } = useQuery({
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
    // Retry transient network failures so an offline cold start can keep the
    // session long enough for AuthProfileError / offline routes to take over.
    // A definitive missing profile (PGRST116) still fails immediately.
    retry: (failureCount, error) => !isDefinitiveProfileAbsence(error) && failureCount < 2,
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

  // Offline service-documentation drafts (BACKLOG.md E5) are bound to one signed-in employee
  // identity. Logout is handled immediately in the SIGNED_IN/SIGNED_OUT effect above; this covers
  // the other half -- a profile/org/role change, or deactivation, observed while the session itself
  // stays signed in (e.g. an admin changes this person's role or facility mid-shift). Proactive, not
  // lazy: the wipe fires here rather than waiting for the offline store to next be opened.
  //
  // Codex review finding: `user` is derived from the profile query below and reads null any time
  // that query has no data yet -- not just on a real sign-out. A session that stays valid can still
  // pass through that state, e.g. right after the SIGNED_IN handler above calls queryClient.clear()
  // and the profile is being fetched again, or during a transient offline/network retry (see the
  // profile query's own retry comment). Treating a still-valid session's momentarily-unresolved
  // profile the same as a genuine identity change would wipe unsynced care notes for no reason.
  // Skip the comparison until the profile fetch actually settles for a session that exists; a
  // session-bearing profile that resolves to a genuinely different identity (or an inactive one)
  // still compares normally below once it does. A DEFINITIVE missing profile still ends in a wipe --
  // the effect further down signs that session out, which reaches the explicit SIGNED_OUT wipe path
  // above -- so this effect doesn't need to duplicate that case. See
  // isOfflineServiceDraftIdentityPending's own comment for why this is a caller-side guard rather
  // than a change to shouldWipeOfflineServiceDraftData itself.
  useEffect(() => {
    if (isOfflineServiceDraftIdentityPending(!!session, !!user)) return;
    const previous = lastOfflineServiceDraftIdentityRef.current;
    const current = user
      ? { profileId: user.id, organizationId: user.organizationId ?? "", role: user.role, active: user.isActive }
      : null;
    if (shouldWipeOfflineServiceDraftData(previous, current)) {
      void wipeOfflineServiceDrafts();
      // BACKLOG.md item 6: this transition wiped the offline draft store but left the react-query
      // cache untouched -- only SIGNED_IN/SIGNED_OUT cleared it, so any query key that does not
      // itself carry the identity (e.g. a bare or profile-id-only key) kept serving the previous
      // role/org/facility's rows until its own staleTime lapsed.
      //
      // Gated on an ACTUAL identity change, not on shouldWipeOfflineServiceDraftData's full result:
      // that function also returns true for every render where current.role isn't "employee" --
      // correct for ITS purpose (the draft store only ever applies to employees, so any non-employee
      // identity is unconditionally wipe-worthy for that store alone, and wiping an already-empty
      // store repeatedly is harmless) -- but clearing the ENTIRE query cache on every one of those
      // calls, not just real transitions, self-sustains: clear() empties the profile query below,
      // the profile refetches, this effect re-runs against the SAME still-non-employee identity, and
      // clears again, forever. That silently broke every non-employee session (org_admin,
      // facility_manager, trainer, auditor, platform_admin) on any session touch -- found via the
      // MFA step-up e2e flake, where refreshSession() is exactly such a touch, but not specific to
      // it: a background token refresh hits the same path in production.
      //
      // Not gating on `active` here leaves deactivation (profile/org/role unchanged, active flips)
      // out of this comparison, but that is not a gap: the dedicated deactivation effect below signs
      // the session out and clears the cache itself whenever `profile.is_active` is false, so this
      // effect's own clear() was always redundant for that case, not load-bearing.
      const identityChanged = !previous || !current
        || previous.profileId !== current.profileId
        || previous.organizationId !== current.organizationId
        || previous.role !== current.role;
      // resetQueries(), not clear(): clear() removes every Query from the cache but does not touch
      // any QueryObserver already mounted and watching one of them -- destroy() only cancels the
      // in-flight fetch, it never notifies observers, so a component that stays mounted across this
      // transition (the case this effect exists for; a component that unmounts doesn't need either
      // call) keeps rendering the previous identity's cached result until something unrelated
      // happens to re-render it, with no refetch queued behind it. Verified directly against the
      // installed @tanstack/query-core: clear() leaves a subscribed observer's getCurrentResult()
      // unchanged; resetQueries() immediately notifies every observer back to pending and refetches
      // the ones that are active, because -- unlike clear() -- it reaches them through
      // queryCache.findAll() before removing anything, rather than deleting the cache entry first
      // and leaving observers to discover that on their own next render. Still followed by an
      // explicit mutation-cache clear to keep clear()'s other effect (discarding stale mutation
      // state/errors from the previous identity, e.g. a leftover error toast trigger).
      if (identityChanged) {
        void queryClient.resetQueries();
        queryClient.getMutationCache().clear();
      }
    }
    lastOfflineServiceDraftIdentityRef.current = current
      ? { profileId: current.profileId, organizationId: current.organizationId, role: current.role }
      : null;
  }, [user?.id, user?.organizationId, user?.role, user?.isActive, session, queryClient]);

  useEffect(() => {
    if (!isLoading && !session && !isError) {
      if (!isPublicPath(window.location.pathname)) {
        setLocation(loginPathWithNext(window.location.pathname, window.location.search, window.location.hash));
      }
    }
  }, [isLoading, session, isError, setLocation]);

  // A valid Auth session with a definitively missing profile cannot be authorized. End the
  // session instead of leaving the visitor in a half-signed-in landing/login loop. Transient
  // load failures (network / offline) keep the session and surface AuthProfileError with retry
  // so a downloaded offline course remains reachable without connectivity.
  useEffect(() => {
    if (!session || !isError || !isDefinitiveProfileAbsence(profileError)) return;
    (async () => {
      await supabase.auth.signOut();
      queryClient.clear();
      toast({
        variant: "destructive",
        title: "Account unavailable",
        description: "Sign in again or contact your administrator.",
      });
      setLocation("/login");
    })();
  }, [session, isError, profileError, queryClient, toast, setLocation]);

  // A deactivated profile still has a valid Supabase session -- isAuthenticated above already
  // treats that as signed out, but the session itself needs to be torn down too, or the very
  // next getSession()/onAuthStateChange tick would let RLS-scoped reads resume as soon as an
  // admin reactivates them without the user needing to sign back in.
  useEffect(() => {
    if (!profile || profile.is_active) return;
    (async () => {
      await supabase.auth.signOut();
      clearImpersonationSession();
      queryClient.clear();
      toast({
        variant: "destructive",
        title: "Account deactivated",
        description: "Your account has been deactivated. Contact your administrator for access.",
      });
      setLocation("/login");
    })();
  }, [profile, queryClient, toast, setLocation]);

  if (session && !profileLoading && isError) {
    return (
      <AuthProfileError
        error={profileError}
        retrying={profileFetching}
        onRetry={() => { void refetchProfile(); }}
        onSignOut={() => {
          void (async () => {
            await supabase.auth.signOut();
            clearImpersonationSession();
            queryClient.clear();
            await clearSupabaseRuntimeCache();
            setLocation("/login");
          })();
        }}
      />
    );
  }

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
    // Always clear, impersonating or not -- otherwise a plain sign-out during impersonation
    // leaves the admin's origin access/refresh tokens in sessionStorage, reusable by the next
    // person to use this browser tab to silently restore that platform_admin session.
    clearImpersonationSession();
    queryClient.clear();
    await clearSupabaseRuntimeCache();
    setLocation("/login");
  };
}
