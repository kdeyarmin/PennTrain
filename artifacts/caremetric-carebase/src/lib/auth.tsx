import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useLocation } from "wouter";
import { supabase, clearSupabaseRuntimeCache } from "./supabase";
import { queryClient } from "./queryClient";
import { isPublicPath } from "./publicPaths";
import { loginPathWithNext } from "./loginRedirect";
import { useToast } from "@/hooks/use-toast";
import { AuthProfileError } from "@/components/AuthProfileError";
import { isDefinitiveProfileAbsence, shouldShowProfileError } from "@/lib/authProfileErrors";
import {
  STORAGE_KEY as IMPERSONATION_STORAGE_KEY, CHANGE_EVENT as IMPERSONATION_CHANGE_EVENT,
  useStopImpersonation,
} from "@/hooks/useImpersonation";
import { wipeOfflineServiceDrafts, type OfflineFloorFacilityScope } from "@/lib/offlineServiceDraftCache";
import { signedInIdentityChanged, type SessionIdentity } from "@/lib/sessionIdentity";
import { canReadOfflineObservationResident, hasAssignedFacilityScope, loadSessionFacilityScope, loadSessionPrimaryFacility } from "@/lib/sessionFacilityScope";
import { readRecoveryGrant, recoveryGrantMatchesSession } from "@/lib/recoveryGrant";
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
  /**
   * The caller's employee facility. `undefined` until its own query settles; `null` once settled
   * for someone with no employees row. See the query below for why it is not on the profile select.
   */
  facilityId?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasRole: (...roles: Role[]) => boolean;
  /** Confirmed employee scope for retained offline care reads; absent when not yet known. */
  offlineFacilityScope?: OfflineFloorFacilityScope;
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

/**
 * The local-state teardown every sign-out must perform -- forced or user-initiated.
 *
 * `supabase.auth.signOut()` on its own only drops the Supabase session from localStorage. Three
 * other pieces of local state outlive it, and each is a real leak:
 *
 *   - The impersonation record in sessionStorage, which holds the ORIGIN platform_admin's
 *     access/refresh tokens. MainLayout's ImpersonationBanner reads that record straight back, and
 *     its "Exit impersonation" button calls `supabase.auth.setSession(originSession)` without
 *     checking that the impersonated session is still the live one. Leaving the record behind
 *     therefore hands whoever uses this browser tab next a working route back into a
 *     platform_admin session. MaintenanceGate's comment already names this as the reason a raw
 *     `supabase.auth.signOut()` is not an acceptable sign-out.
 *   - The react-query cache, whose keys are not all identity-scoped.
 *   - The Supabase runtime/storage Cache Storage entries, which hold already-fetched PHI responses.
 *
 * useSignOut() always did all three. The forced sign-out paths each did a different subset -- the
 * definitive-profile-absence path did neither of the first and third, which is precisely the
 * stranded-origin-token case above. Routing them all through one function is what stops the next
 * forced-sign-out path from picking a subset again.
 */
export async function clearLocalSessionState(): Promise<void> {
  clearImpersonationSession();
  queryClient.clear();
  await clearSupabaseRuntimeCache();
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
// `pendingRecoveryGrant` below reflects THAT tab's own URL, not the tab that actually opened
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
// Consumed on the first MATCHING session-bearing check, not tied to a specific event name.
// Matching the exact token matters: a refused link can leave a different, ordinary session in
// storage, and merely seeing type=invite/recovery must never mark that session as the link's.
// GoTrue always fires an INITIAL_SESSION event -- already carrying the freshly-established session
// -- strictly before the "real" SIGNED_IN/PASSWORD_RECOVERY notification it schedules a tick later
// for a URL-hash grant. Gating the read/clear on `event === "SIGNED_IN"` specifically would leave
// `session` (set unconditionally at the end of every branch below) pointing at the real invite
// session while `isRecoverySession` still defaults to its prior value during that earlier
// INITIAL_SESSION pass -- a real, if brief, window where isAuthenticated could read true before the
// deferred SIGNED_IN event arrives a tick later to correct it. Resolving through this single
// function on every event (see resolveIsRecoverySession) closes that window: isRecoverySession is
// derived atomically alongside `session` for every event, including the first one.
let pendingRecoveryGrant = readRecoveryGrant(window.location.hash);

// Single source of truth for "is this session a not-yet-confirmed recovery/invite session."
// Called for every session this tab observes (the initial getSession() read, and every
// onAuthStateChange event except SIGNED_OUT) so it's reached regardless of which specific event
// first carries the session, and regardless of whether that event was raised by an implicit-grant
// URL this tab itself loaded or relayed from another tab via supabase-js's cross-tab broadcast.
function resolveIsRecoverySession(session: Session | null, isPasswordRecoveryEvent = false): boolean {
  if (session && (isPasswordRecoveryEvent || recoveryGrantMatchesSession(pendingRecoveryGrant, session))) {
    pendingRecoveryGrant = null;
    markRecoverySession(session.user.id);
    return true;
  }
  return isKnownRecoverySession(session);
}

// Only a successful password response can retire this account's recovery marker. A time
// window before sign-in also accepted unrelated cross-tab SIGNED_IN events after a failed
// password. Subscribers compare the exact returned session before updating current UI state.
const passwordSignInListeners = new Set<(session: Session) => void>();
export async function signInWithPassword(credentials: Parameters<typeof supabase.auth.signInWithPassword>[0]) {
  const unlockMarker = idleUnlockSignInExpiresAt;
  const attempt = Symbol("password-attempt");
  // The short window only arms the next request. Once started, preserve that attempt through
  // slow connections until its response settles; a newer password request replaces it.
  pendingIdleUnlockAttempt = Date.now() < unlockMarker ? attempt : null;
  try {
    const result = await supabase.auth.signInWithPassword(credentials);
    if (!result.error && result.data.session) {
      for (const listener of passwordSignInListeners) listener(result.data.session);
    }
    return result;
  } finally {
    if (pendingIdleUnlockAttempt === attempt) pendingIdleUnlockAttempt = null;
    if (idleUnlockSignInExpiresAt === unlockMarker) idleUnlockSignInExpiresAt = 0;
  }
}

// Preserve the in-place password step of an idle unlock for its current account.
//
// IdleSessionLock unlocks with a real signInWithPassword, which mints a new session and fires
// SIGNED_IN -- and SIGNED_IN clears the whole react-query cache. Both session gates then fall back
// to their full-screen spinners while their own queries reload, so the route unmounts and whatever
// the user had half-typed is gone, underneath a banner promising "continue without losing the
// current page". Nothing about that clear was needed: the account is the same account, which is
// why the handler additionally checks the user id below rather than trusting this flag alone.
let idleUnlockSignInExpiresAt = 0;
let pendingIdleUnlockAttempt: symbol | null = null;
export function markIdleUnlockSignIn() {
  idleUnlockSignInExpiresAt = Date.now() + 15_000;
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
  // Separate from the offline-draft snapshot above: that one answers "may this identity hold
  // drafts" and carries no facility, this one answers "is the cache populated for someone else".
  const lastCacheIdentityRef = useRef<SessionIdentity | null>(null);
  const offlineScopeIdentityRef = useRef({ key: "", generation: 0 });

  useEffect(() => {
    let active = true;
    let observedAuthEvent = false;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active || observedAuthEvent) return;
      if (error) throw error;
      const recoverySession = resolveIsRecoverySession(data.session);
      lastSessionRef.current = data.session;
      setSession(data.session);
      setIsRecoverySession(recoverySession);
      setSessionLoading(false);
    }).catch(() => {
      if (!active || observedAuthEvent) return;
      setSessionLoading(false);
      toast({
        variant: "destructive",
        title: "Couldn't restore your session",
        description: "Sign in again to continue.",
      });
    });

    const confirmPasswordSession = (confirmed: Session) => {
      if (!active || confirmed.user.id !== lastSessionRef.current?.user.id
        || confirmed.access_token !== lastSessionRef.current?.access_token) return;
      pendingRecoveryGrant = null;
      clearRecoverySession(confirmed.user.id);
      setIsRecoverySession(false);
    };
    passwordSignInListeners.add(confirmPasswordSession);

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      observedAuthEvent = true;
      if (event === "SIGNED_OUT" || nextSession?.user.id !== lastSessionRef.current?.user.id) {
        // Cancel captured draft access before React renders the replacement account. A generation
        // also keeps an A -> B -> A transition from reactivating A's earlier asynchronous read.
        offlineScopeIdentityRef.current = { key: "", generation: offlineScopeIdentityRef.current.generation + 1 };
      }
      // Auth re-announces SIGNED_IN when a tab becomes visible, even when its session is
      // unchanged. Clearing then unmounts the security gates and discards the page's drafts.
      // Compare the token as well as the account: a new password session must still clear.
      const isRepeatedSession = !!nextSession
        && nextSession.user.id === lastSessionRef.current?.user.id
        && nextSession.access_token === lastSessionRef.current?.access_token;
      // Same account, same tab, one continuous piece of work: an idle-lock unlock. The user id
      // check is the real guard -- the marker alone would let any SIGNED_IN inside the window keep
      // another account's cached data on screen.
      const isIdleUnlockSignIn =
        event === "SIGNED_IN" && !!nextSession
        && (pendingIdleUnlockAttempt !== null || Date.now() < idleUnlockSignInExpiresAt)
        && nextSession.user.id === lastSessionRef.current?.user.id;
      if ((event === "SIGNED_IN" && !isRepeatedSession) || event === "SIGNED_OUT") {
        idleUnlockSignInExpiresAt = 0;
        pendingIdleUnlockAttempt = null;
      }

      if (event === "SIGNED_OUT") {
        clearRecoverySession(lastSessionRef.current?.user.id);
        setIsRecoverySession(false);
        // Logout is the clearest possible identity-change signal, and does not need to wait for the
        // (now-disabled) profile query below to settle: wipe the offline service-documentation draft
        // store immediately.
        void wipeOfflineServiceDrafts();
        lastOfflineServiceDraftIdentityRef.current = null;
        // And clear everything else the session left behind (BACKLOG.md I8).
        //
        // useSignOut() and all four forced-sign-out paths call clearLocalSessionState(); this
        // handler -- the ONLY thing that runs when the SERVER ends the session (a revocation from
        // /account/security or the platform console, an expired refresh token, the admin signOut
        // that ends an impersonation) -- did not. So exactly the sign-out the user did not choose
        // was the one that left the impersonation record, with the origin platform_admin's
        // access and refresh tokens, sitting in sessionStorage for whoever used the tab next,
        // alongside the react-query cache and the Cache Storage entries holding fetched PHI.
        //
        // Safe for the impersonation exit paths that sign out locally on purpose: both read
        // originSession into a local const BEFORE calling signOut, so clearing the record here
        // cannot take the tokens they are about to restore from.
        void clearLocalSessionState();
      } else {
        setIsRecoverySession(resolveIsRecoverySession(nextSession, event === "PASSWORD_RECOVERY"));
      }
      lastSessionRef.current = nextSession;
      setSession(nextSession);
      setSessionLoading(false);
      if (event === "SIGNED_IN" && !isIdleUnlockSignIn && !isRepeatedSession) {
        void clearSupabaseRuntimeCache();
        queryClient.clear();
      } else {
        // Recheck authorization scope without discarding work for an unchanged session.
        // Facility membership lives separately from the profile and can change mid-session.
        queryClient.invalidateQueries({ queryKey: ["profile"] });
        queryClient.invalidateQueries({ queryKey: ["profile-facility"] });
      }
    });

    return () => {
      active = false;
      offlineScopeIdentityRef.current = { key: "", generation: offlineScopeIdentityRef.current.generation + 1 };
      passwordSignInListeners.delete(confirmPasswordSession);
      subscription.subscription.unsubscribe();
    };
  }, [queryClient, toast]);

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

  // Facility is the authoritative scope for most resident data and lives on employees, not
  // profiles -- so the identity comparison below cannot see a facility transfer without it.
  //
  // Its own query rather than an embed on the profile select above. A PostgREST embed fails the
  // WHOLE request, so `.select("*, employees(facility_id)")` would put every sign-in behind the
  // employees RLS policy resolving correctly for every role. Separate, this degrades to
  // "facility unknown" instead of "cannot sign in", and the predicate is built to treat unknown as
  // not-a-change.
  const { data: facilityId } = useQuery({
    queryKey: ["profile-facility", profile?.id],
    queryFn: () => loadSessionPrimaryFacility(profile!.id),
    enabled: !!profile?.id,
  });

  // Keep the public primary-facility value above unchanged. Secondary employee assignments and
  // manager/trainer profile assignments also change access, without changing that primary value.
  // The shared prefix is refreshed by auth events and by successful MFA/idle-lock verification.
  const { data: authorizedFacilityIds } = useQuery({
    queryKey: ["profile-facility", "scope", profile?.id, profile?.organization_id, profile?.role],
    queryFn: () => loadSessionFacilityScope(profile!),
    enabled: !!profile?.id && hasAssignedFacilityScope(profile.role),
  });

  const user: AuthUser | null = profile
    ? {
        id: profile.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        email: profile.email,
        role: profile.role as Role,
        organizationId: profile.organization_id,
        isActive: profile.is_active,
        facilityId,
      }
    : null;

  const previousScopeIdentity = lastCacheIdentityRef.current;
  const lastKnownFacilities = previousScopeIdentity?.profileId === user?.id
    && previousScopeIdentity?.organizationId === user?.organizationId
    && previousScopeIdentity?.role === user?.role
    ? previousScopeIdentity?.authorizedFacilityIds : undefined;
  const offlineFacilityIds = user?.role === "employee"
    ? authorizedFacilityIds ?? lastKnownFacilities : undefined;
  const offlineScopeIdentity = JSON.stringify([user?.id, user?.organizationId, user?.role, offlineFacilityIds]);
  if (offlineScopeIdentityRef.current.key !== offlineScopeIdentity) {
    offlineScopeIdentityRef.current = { key: offlineScopeIdentity, generation: offlineScopeIdentityRef.current.generation + 1 };
  }
  const offlineScopeGeneration = offlineScopeIdentityRef.current.generation;
  const offlineFacilityScope = useMemo<OfflineFloorFacilityScope | undefined>(() => offlineFacilityIds === undefined ? undefined : ({
    facilityIds: offlineFacilityIds,
    isCurrent: () => offlineScopeIdentityRef.current.generation === offlineScopeGeneration,
    canReadResident: canReadOfflineObservationResident,
  }), [offlineScopeIdentity, offlineScopeGeneration]);

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
    const current = user
      ? {
          profileId: user.id, organizationId: user.organizationId ?? "", role: user.role,
          active: user.isActive, facilityId: user.facilityId,
        }
      : null;
    const wipeForIdentity = shouldWipeOfflineServiceDraftData(lastOfflineServiceDraftIdentityRef.current, current);
    // BACKLOG.md open question 6. Wiping the offline drafts was only half of it: every OTHER
    // identity transition in this file also calls queryClient.clear(), and this one -- the transition
    // where the session survives -- did not. A cached query whose key does not itself carry the
    // identity therefore kept serving the previous context's rows until its own staleTime lapsed.
    // Two hooks were fixed at the point of use by putting the identity in their keys, but that
    // treated the symptom; the cause is that nothing clears here.
    //
    // Deliberately NOT gated on shouldWipeOfflineServiceDraftData above, even though it is right
    // there: that predicate treats any non-employee role as "wipe", which is correct for an
    // employee-only draft store and would mean clearing every manager's entire cache on every
    // evaluation. See sessionIdentity.ts.
    //
    // What this cannot reach: a signed storage URL already handed to the browser stays
    // bearer-authorized for its full TTL regardless of what RLS would now say. Clearing the cache
    // stops the app re-serving it, which is the whole of what a client can do about that.
    const previousIdentity = lastCacheIdentityRef.current;
    const currentCacheIdentity: SessionIdentity | null = current
      ? { profileId: current.profileId, organizationId: current.organizationId,
          role: current.role, facilityId: user?.facilityId,
          authorizedFacilityIds: authorizedFacilityIds ?? undefined }
      : null;
    // An unavailable read (including a server idle lock) must neither revoke access nor erase
    // the last resolved comparison baseline. A real identity replacement must not inherit it.
    if (previousIdentity && currentCacheIdentity
      && previousIdentity.profileId === currentCacheIdentity.profileId
      && previousIdentity.organizationId === currentCacheIdentity.organizationId
      && previousIdentity.role === currentCacheIdentity.role
      && currentCacheIdentity.authorizedFacilityIds === undefined) {
      currentCacheIdentity.authorizedFacilityIds = previousIdentity.authorizedFacilityIds;
    }
    // Scope-only revocation is reconciled per draft at read/sync time, including after a reload;
    // it must preserve allowed care documentation. Real identity changes still retire the store.
    if (wipeForIdentity) void wipeOfflineServiceDrafts();
    lastCacheIdentityRef.current = currentCacheIdentity;
    lastOfflineServiceDraftIdentityRef.current = current
      ? {
          profileId: current.profileId, organizationId: current.organizationId, role: current.role,
          facilityId: current.facilityId,
        }
      : null;
    if (signedInIdentityChanged(previousIdentity, currentCacheIdentity)) {
      void clearSupabaseRuntimeCache();
      queryClient.clear();
    }
    // facilityId is in the dependency list, not merely in the comparison: without it this effect
    // would never re-run on a transfer, so the predicate would never be asked.
  }, [user?.id, user?.organizationId, user?.role, user?.isActive, user?.facilityId, authorizedFacilityIds, session, queryClient]);

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
      await clearLocalSessionState();
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
      await clearLocalSessionState();
      toast({
        variant: "destructive",
        title: "Account deactivated",
        description: "Your account has been deactivated. Contact your administrator for access.",
      });
      setLocation("/login");
    })();
  }, [profile, queryClient, toast, setLocation]);

  // The rule and the reason live in shouldShowProfileError: blank the app only when there is no
  // profile to run on, never merely because the last refetch failed.
  if (shouldShowProfileError({ hasSession: !!session, isError, hasProfile: !!profile })) {
    return (
      <AuthProfileError
        error={profileError}
        retrying={profileFetching}
        onRetry={() => { void refetchProfile(); }}
        onSignOut={() => {
          void (async () => {
            await supabase.auth.signOut();
            await clearLocalSessionState();
            setLocation("/login");
          })();
        }}
      />
    );
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAuthenticated, offlineFacilityScope, hasRole: (...roles) => hasRole(user, ...roles) }}
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
  const stopImpersonation = useStopImpersonation();
  return async () => {
    // While impersonating, the live session belongs to the TARGET -- and auth-js's signOut
    // defaults to `scope: 'global'`, which revokes every session that user holds, on every device
    // they are signed in on. The impersonation also ended with no `impersonation_end` audit row,
    // because impersonate-user's `end` action is the only thing that writes one, and behind an
    // MFA-required tenant's wall this "Sign out" was the only exit on screen.
    //
    // So end the impersonation first: that revokes exactly the impersonated session, writes the
    // audit row, and restores the administrator's own session -- which is the session this
    // sign-out is actually for. Everything after this line is then the ordinary path.
    if (sessionStorage.getItem(IMPERSONATION_STORAGE_KEY)) {
      try {
        await stopImpersonation.mutateAsync();
      } catch (error) {
        // The impersonated session is still the live one, so a global sign-out here would do the
        // exact damage this branch exists to prevent. Drop the local session only, and say what
        // did not happen -- the audit row for this impersonation is now the operator's to explain.
        toast({
          variant: "destructive",
          title: "Signed out without ending impersonation",
          description: error instanceof Error ? error.message : String(error),
        });
        await supabase.auth.signOut({ scope: "local" });
        await clearLocalSessionState();
        setLocation("/login");
        return;
      }
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({ variant: "destructive", title: "Sign out failed", description: error.message });
    }
    // Always clear, impersonating or not -- otherwise a plain sign-out during impersonation
    // leaves the admin's origin access/refresh tokens in sessionStorage, reusable by the next
    // person to use this browser tab to silently restore that platform_admin session.
    await clearLocalSessionState();
    setLocation("/login");
  };
}
