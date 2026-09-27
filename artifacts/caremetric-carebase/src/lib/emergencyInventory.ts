import { facilityToday } from "./dateUtils";

interface InventoryReadiness {
  status: string;
  quantity: number | string;
  minimum_quantity: number | string;
  expiration_date: string | null;
}

/** Readiness follows both the last staff check and facts that may have changed since that check. */
export function emergencyInventoryStatus(item: InventoryReadiness, today = facilityToday()): string {
  if (item.status === "unavailable") return "unavailable";
  if (item.status === "expired" || (item.expiration_date && item.expiration_date < today)) return "expired";
  if (item.status === "low" || Number(item.quantity) < Number(item.minimum_quantity)) return "low";
  return item.status;
}
