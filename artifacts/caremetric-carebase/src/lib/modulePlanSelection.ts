import type { Json } from "./database.types";
import { PRODUCT_MODULES, withModuleDependencies, type PurchasableProductModuleId } from "./productModules";

/** Exact access matching prevents a narrower selection from silently buying a broader suite. */
export function packageMatchesModules(features: Json | null, requested: PurchasableProductModuleId[], independent: PurchasableProductModuleId[] = []) {
  if (!features || typeof features !== "object" || Array.isArray(features)) return false;
  const actual = withModuleDependencies([...PRODUCT_MODULES.filter(m => features[m.entitlementKey] === true).map(m => m.id), ...independent]);
  const expected = withModuleDependencies(requested);
  return PRODUCT_MODULES.every(m => actual.has(m.id) === expected.has(m.id));
}
