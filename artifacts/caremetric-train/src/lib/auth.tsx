import { createContext, useContext, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useLocation } from "wouter";
import { supabase } from "./supabase";
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

export function isPlatformAdmin(user: AuthUser | null): boolean {
  return hasRole(user, "platform_admin");
}

export function canManageOrganization(user: AuthUser | null): boolean {
  return hasRole(user, "platform_admin", "org_admin", "facility_manager");
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
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
  const isAuthenticated = !!session && !!profile;

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
    setLocation("/login");
  };
}
