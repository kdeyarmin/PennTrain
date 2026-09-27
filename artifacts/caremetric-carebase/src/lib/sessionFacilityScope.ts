import { supabase } from "./supabase";

interface ScopedProfile { id: string; organization_id: string | null; role: string }

/** These roles derive access from assignment rows, rather than organization-wide access. */
export function hasAssignedFacilityScope(role: string | undefined): boolean {
  return role === "employee" || role === "facility_manager" || role === "trainer";
}

async function allFacilityIds(page: (from: number, to: number) => PromiseLike<{
  data: { facility_id: string }[] | null; error: unknown;
}>): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ;) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    ids.push(...(data ?? []).map(row => row.facility_id));
    if (!data || data.length === 0) return ids;
    // The deployment's API row cap can be lower than the requested range size.
    from += data.length;
  }
}

async function sessionUnlocked(signal?: AbortSignal) {
  const request = supabase.rpc("current_session_unlocked");
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return data === true;
}

/** Legacy observation drafts have no facility ID; authorize the resident's current location. */
export async function canReadOfflineObservationResident(residentId: string, timeoutMs = 5_000): Promise<boolean | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => {
    timeout = setTimeout(() => { controller.abort(); resolve(null); }, Math.min(timeoutMs, 5_000));
  });
  try {
    return await Promise.race([deadline, (async () => {
      if (!await sessionUnlocked(controller.signal)) return null;
      controller.signal.throwIfAborted();
      const { error } = await supabase.rpc("log_clinical_access", {
        p_resident_id: residentId,
        p_access_kind: "view_domain",
        p_clinical_domain: "observations",
        p_minimum_necessary_reason: "Review retained offline clinical observation draft",
      }).abortSignal(controller.signal);
      controller.signal.throwIfAborted();
      if (!await sessionUnlocked(controller.signal)) return null;
      controller.signal.throwIfAborted();
      if (!error) return true;
      // 42501 alone also means SMS/MFA, lock or another temporary policy failure.
      return error.code === "42501" && error.message === "Clinical access is outside caller scope" ? false : null;
    })()]);
  } catch {
    return null; // unknown/offline preserves care documentation
  } finally {
    clearTimeout(timeout);
  }
}

/** Retain the cached primary facility when a temporary security gate makes RLS return no row. */
export async function loadSessionPrimaryFacility(profileId: string): Promise<string | null> {
  const assertUnlocked = async () => {
    if (!await sessionUnlocked()) throw new Error("Facility scope is unavailable while the session is locked or awaiting verification");
  };
  await assertUnlocked();
  const { data, error } = await supabase.from("employees").select("facility_id")
    .eq("profile_id", profileId).maybeSingle();
  if (error) throw error;
  await assertUnlocked();
  return data?.facility_id ?? null;
}

/**
 * Private cache identity, not a replacement for AuthUser.facilityId or server authorization.
 * Employee clinical gates use an active employee plus employee_serves_facility (primary OR
 * employee assignments). Managers/trainers use is_assigned_to_facility (profile assignments,
 * active same-tenant facilities). These compatibility assignment tables have no effective dates;
 * enterprise_scope_memberships is a separate, effective-dated shadow and is not this access gate.
 * A server idle lock makes RLS reads empty temporarily; null means unknown, never revoked scope.
 */
export async function loadSessionFacilityScope(profile: ScopedProfile): Promise<string[] | null> {
  if (!hasAssignedFacilityScope(profile.role)) return null;
  if (!await sessionUnlocked()) return null;
  let ids: string[];
  if (!profile.organization_id) {
    ids = [];
  } else if (profile.role === "employee") {
    const { data: employee, error } = await supabase.from("employees")
      .select("id, facility_id, status")
      .eq("profile_id", profile.id).eq("organization_id", profile.organization_id).maybeSingle();
    if (error) throw error;
    ids = employee?.status === "active" ? [employee.facility_id, ...await allFacilityIds((from, to) =>
      supabase.from("employee_facility_assignments").select("facility_id")
        .eq("employee_id", employee.id).eq("organization_id", profile.organization_id!)
        .order("facility_id").range(from, to),
    )] : [];
  } else {
    ids = await allFacilityIds((from, to) => supabase.from("facility_assignments")
      .select("facility_id, facilities!inner(id)")
      .eq("profile_id", profile.id).eq("facilities.organization_id", profile.organization_id!)
      .eq("facilities.is_active", true).order("facility_id").range(from, to));
  }
  // Also cover a lock established while the assignment reads were in flight.
  if (!await sessionUnlocked()) return null;
  return [...new Set(ids)].sort();
}
