import type { Tables } from "@/lib/database.types";

export type ResidentRow = Tables<"residents">;
export type FacilityRow = Tables<"facilities">;

/**
 * Everything a resident tab needs that it cannot cheaply re-derive. Data itself is fetched by each
 * tab through the shared React Query cache rather than threaded down as props -- that keeps tab
 * chunks independent (the point of the split) while still costing one fetch per query key.
 */
export interface ResidentTabProps {
  resident: ResidentRow;
  facility: FacilityRow | undefined;
  canManage: boolean;
  canDelete: boolean;
  /** PCH/ALF rule-pack facility -- gates compliance-item and support-plan surfaces. */
  isTrackedFacilityType: boolean;
  /** "/app/residents" or "/admin/residents", so nested links stay on the caller's route family. */
  residentPathPrefix: string;
  isPlatformRoute: boolean;
}
