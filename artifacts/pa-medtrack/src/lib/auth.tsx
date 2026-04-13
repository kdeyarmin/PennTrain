import { createContext, useContext, useEffect, useState } from "react";
import { useGetMe, getGetMeQueryKey, User } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
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
  const { data: user, isLoading, isError } = useGetMe({
    query: {
      retry: false,
      queryKey: getGetMeQueryKey(),
    },
  });

  const isAuthenticated = !!user;

  useEffect(() => {
    if (!isLoading && isError) {
      // If we are not on login or forgot password, redirect to login
      const path = window.location.pathname;
      if (path !== "/login" && path !== "/forgot-password") {
        setLocation("/login");
      }
    }
  }, [isLoading, isError, setLocation]);

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading, isAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
