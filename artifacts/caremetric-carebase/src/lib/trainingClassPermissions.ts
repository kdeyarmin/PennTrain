import type { Role } from "@/lib/auth";

/**
 * Who may write to a training class, mirroring the `training_classes_write` policy, so a screen can
 * say what will happen instead of offering a control the database refuses (BACKLOG.md J30).
 *
 * The policy's trainer branch is now:
 *
 *   current_role() = 'trainer'
 *   and trainer_profile_id = auth.uid()
 *   and (facility_id is null or is_assigned_to_facility(facility_id))
 *
 * It used to require `facility_id is not null`, which is the half of J30 that bit: a cross-facility
 * class -- `facility_id` null, which TrainerClasses.tsx offers as "Any / Cross-facility" and
 * ClassKiosk.tsx already handles as a first-class case -- failed it for the owning trainer and for
 * a facility_manager alike, while `training_classes_select` happily showed it to them. This module
 * mirrored that and told them so.
 *
 * `20260906220000` fixed the policy: ownership is the authorization for a class with no facility,
 * and the facility test now scopes only a class that has one. Mirroring the OLD rule after that is
 * the same defect pointing the other way -- the page banners "You cannot make changes to this
 * session" and hides every control, including Cancel class, for a session the database would
 * accept. The `cross_facility` block is gone with the rule it described.
 */

/** Roles the policy admits without any facility test. */
const FACILITY_EXEMPT_ROLES: ReadonlySet<string> = new Set(["platform_admin", "org_admin"]);

export interface TrainingClassWriteContext {
  role: Role | null | undefined;
  /** The current user's profile id, compared against the class's trainer_profile_id. */
  profileId: string | null | undefined;
  /** Facility ids the current user has an explicit facility_assignments row for. */
  assignedFacilityIds: ReadonlySet<string>;
}

export interface TrainingClassIdentity {
  facility_id: string | null;
  trainer_profile_id: string | null;
}

export type TrainingClassWriteBlock =
  /** The role has no write branch in the policy at all. */
  | "role"
  /** A trainer who does not own this class. */
  | "not_owner"
  /** A real facility, but outside the caller's assignments. */
  | "unassigned_facility";

/**
 * Why the policy will refuse this caller's write, or null when it will not.
 *
 * Returns the reason rather than a boolean so a screen can explain the refusal -- "this class is
 * not tied to a facility" and "this class is at a facility you are not assigned to" need different
 * next steps from the person reading them.
 */
export function trainingClassWriteBlock(
  cls: TrainingClassIdentity,
  { role, profileId, assignedFacilityIds }: TrainingClassWriteContext,
): TrainingClassWriteBlock | null {
  if (!role) return "role";
  if (FACILITY_EXEMPT_ROLES.has(role)) return null;
  if (role !== "facility_manager" && role !== "trainer") return "role";
  if (role === "trainer" && (!profileId || cls.trainer_profile_id !== profileId)) return "not_owner";
  // A class with no facility is scoped by ownership alone, exactly as the policy now scopes it.
  if (cls.facility_id === null) return null;
  return assignedFacilityIds.has(cls.facility_id) ? null : "unassigned_facility";
}

export function canWriteTrainingClass(
  cls: TrainingClassIdentity,
  context: TrainingClassWriteContext,
): boolean {
  return trainingClassWriteBlock(cls, context) === null;
}

/** One sentence naming the refusal and the way round it. */
export function describeTrainingClassWriteBlock(block: TrainingClassWriteBlock): string {
  switch (block) {
    case "unassigned_facility":
      return "This session is at a facility you are not assigned to. Ask an administrator for an assignment to that facility, or to run the session for you.";
    case "not_owner":
      return "This session is assigned to a different trainer. Only its own trainer or an administrator can run it.";
    case "role":
      return "Your role cannot change training sessions.";
  }
}
