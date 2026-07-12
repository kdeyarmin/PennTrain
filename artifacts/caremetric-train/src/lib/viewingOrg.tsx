import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./auth";

/**
 * "Viewing as Org X" -- a UX-only convenience for platform_admin, NOT a security boundary.
 * platform_admin already has unrestricted read+write RLS access to every table regardless of
 * this selection (is_platform_admin() bypasses org scoping in every policy); this context only
 * lets platform_admin narrow which org's data the /admin/* list pages display, instead of always
 * seeing every organization's rows mixed together. Selecting an org here does not change what a
 * platform_admin CAN do, only what a handful of pages choose to filter down to for readability.
 *
 * Persisted in sessionStorage (not localStorage) so it resets on a fresh browser session/tab but
 * survives navigation and reloads within one.
 */

const STORAGE_KEY = "cmtrain.viewingOrgId";

interface ViewingOrgContextType {
  viewingOrgId: string | null;
  setViewingOrgId: (orgId: string | null) => void;
}

const ViewingOrgContext = createContext<ViewingOrgContextType>({
  viewingOrgId: null,
  setViewingOrgId: () => {},
});

export function ViewingOrgProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [viewingOrgId, setViewingOrgIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(STORAGE_KEY);
  });

  // Only platform_admin has anything to "view as" -- any other role's own organization_id
  // already scopes everything they see via RLS, so this concept is meaningless for them.
  useEffect(() => {
    if (user && user.role !== "platform_admin" && viewingOrgId !== null) {
      setViewingOrgIdState(null);
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [user, viewingOrgId]);

  const setViewingOrgId = (orgId: string | null) => {
    setViewingOrgIdState(orgId);
    if (orgId) window.sessionStorage.setItem(STORAGE_KEY, orgId);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  };

  return (
    <ViewingOrgContext.Provider value={{ viewingOrgId: user?.role === "platform_admin" ? viewingOrgId : null, setViewingOrgId }}>
      {children}
    </ViewingOrgContext.Provider>
  );
}

export function useViewingOrg() {
  return useContext(ViewingOrgContext);
}
