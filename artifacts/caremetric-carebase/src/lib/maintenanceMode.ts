/**
 * Maintenance-mode access decision.
 *
 * When a platform admin enables `maintenance_mode` (platform_settings), non-admin users are
 * held out of the authenticated app *UI* (React routing in App.tsx). That is the full extent
 * of the enforcement: it is a courtesy gate, not write-quiescence. Direct API clients, guest
 * token holders, and already-open tabs (which only re-poll the flag every ~60s) can keep
 * reading and writing until their next poll -- do not rely on this flag to quiesce traffic
 * for a migration; use a database-level control if that is ever genuinely required.
 * Platform admins always pass through deliberately -- they are the ones who enabled it and
 * must be able to reach /admin/settings to turn it back off.
 *
 * The caller reads `maintenanceMode` from usePlatformStatus(), which fails open (resolves to
 * false on any network/function error and is `undefined` while loading), so this gate can only
 * ever engage on a *confirmed* `true`. Keeping the rule here as a pure function makes the
 * fail-open, admin-bypass behavior directly unit-testable, independent of the router.
 */
export function shouldBlockForMaintenance(
  maintenanceMode: boolean | undefined,
  role: string | undefined,
): boolean {
  return maintenanceMode === true && role !== "platform_admin";
}
