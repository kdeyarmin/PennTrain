import { createContext, useContext, useEffect, useState } from "react";
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
// underlying session is visible.
const RECOVERY_SESSION_KEY = "cmt-recovery-user-id";

function isKnownRecoverySession(session: Session | null): boolean {
  return !!session && window.localStorage.getItem(RECOVERY_SESSION_KEY) === session.user.id;
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsRecoverySession(isKnownRecoverySession(data.session));
      setSessionLoading(false);
    });

    // SIGNED_IN fires only on an explicit sign-in action (Login/Signup/Demo all funnel through
    // supabase.auth.signInWithPassword) -- never on session-restore-from-storage (that's
    // INITIAL_SESSION) -- so clearing here can't wipe an already-authenticated tab on refresh,
    // but does stop a second user's sign-in on a shared device from reusing the previous
    // tenant's cached query data.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        if (nextSession) {
          window.localStorage.setItem(RECOVERY_SESSION_KEY, nextSession.user.id);
        }
        setIsRecoverySession(true);
      } else if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        window.localStorage.removeItem(RECOVERY_SESSION_KEY);
        setIsRecoverySession(false);
      } else {
        setIsRecoverySession(isKnownRecoverySession(nextSession));
      }
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
