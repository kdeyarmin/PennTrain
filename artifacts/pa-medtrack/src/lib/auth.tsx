import { createContext, useContext, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useLocation } from "wouter";
import { supabase } from "./supabase";

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
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
});

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
      const path = window.location.pathname;
      if (path !== "/login" && path !== "/forgot-password" && !path.startsWith("/verify/")) {
        setLocation("/login");
      }
    }
  }, [isLoading, session, isError, setLocation]);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
