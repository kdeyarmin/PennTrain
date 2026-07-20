import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  ALL_PRODUCT_MODULE_IDS,
  ALL_PURCHASABLE_PRODUCT_MODULE_IDS,
  PRODUCT_MODULES,
  canAccessProductPath,
  moduleHomePathForRole,
  parseBuildProductModules,
  withModuleDependencies,
  type ProductModuleId,
  type PurchasableProductModuleId,
} from "@/lib/productModules";

interface ProductModuleAccessContextValue {
  enabledModules: ReadonlySet<ProductModuleId>;
  isLoading: boolean;
  isError: boolean;
  canAccessModule: (moduleId: ProductModuleId) => boolean;
  canAccessPath: (path: string) => boolean;
  homePath: string | null;
}

const ALL_MODULES = withModuleDependencies(ALL_PRODUCT_MODULE_IDS);
const CORE_ONLY = withModuleDependencies([]);

const ProductModuleAccessContext = createContext<ProductModuleAccessContextValue>({
  enabledModules: ALL_MODULES,
  isLoading: false,
  isError: false,
  canAccessModule: () => true,
  canAccessPath: () => true,
  homePath: null,
});

const BUILD_MODULES = parseBuildProductModules(import.meta.env.VITE_CAREMETRIC_MODULES);

export function ProductModuleAccessProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const shouldLoadEntitlements = !!user?.organizationId && isAuthenticated && user.role !== "platform_admin";
  const entitlements = useQuery({
    queryKey: ["product-module-entitlements", user?.organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_effective_entitlements", {
        p_organization_id: user!.organizationId!,
      });
      if (error) throw error;
      return data;
    },
    enabled: shouldLoadEntitlements,
    staleTime: 5 * 60_000,
  });

  const enabledModules = useMemo(() => {
    if (!user || !isAuthenticated) return CORE_ONLY;
    if (user.role === "platform_admin") return BUILD_MODULES;
    if (!shouldLoadEntitlements || entitlements.isError) return CORE_ONLY;
    if (!entitlements.data) return CORE_ONLY;

    const rows = new Map(entitlements.data.map((row) => [row.feature_key, row]));
    const hasModuleDefinitions = PRODUCT_MODULES.some((module) => rows.has(module.entitlementKey));
    // Rolling-deploy compatibility: the frontend may reach production before the migration. An
    // old database has no module definition rows at all, so preserve the pre-module experience
    // until the authoritative contract is available. Once any module definition exists, missing
    // or false entitlements fail closed.
    const commerciallyEnabled: ProductModuleId[] = hasModuleDefinitions
      ? ALL_PURCHASABLE_PRODUCT_MODULE_IDS.filter((moduleId) => {
          const definition = PRODUCT_MODULES.find((module) => module.id === moduleId)!;
          return rows.get(definition.entitlementKey)?.is_entitled === true;
        })
      : [...ALL_PURCHASABLE_PRODUCT_MODULE_IDS];

    return withModuleDependencies(
      commerciallyEnabled.filter((moduleId) => BUILD_MODULES.has(moduleId)),
    );
  }, [entitlements.data, entitlements.isError, isAuthenticated, shouldLoadEntitlements, user]);

  const value = useMemo<ProductModuleAccessContextValue>(() => ({
    enabledModules,
    isLoading: shouldLoadEntitlements && entitlements.isLoading,
    isError: shouldLoadEntitlements && entitlements.isError,
    canAccessModule: (moduleId) => enabledModules.has(moduleId),
    canAccessPath: (path) => canAccessProductPath(path, enabledModules),
    homePath: moduleHomePathForRole(user?.role, enabledModules),
  }), [enabledModules, entitlements.isError, entitlements.isLoading, shouldLoadEntitlements, user?.role]);

  return (
    <ProductModuleAccessContext.Provider value={value}>
      {children}
    </ProductModuleAccessContext.Provider>
  );
}

export function useProductModuleAccess() {
  return useContext(ProductModuleAccessContext);
}
