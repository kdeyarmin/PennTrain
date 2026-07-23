/**
 * Maintenance-mode access decision.
 *
 * When a platform admin enables `maintenance_mode` (platform_settings), non-admin users are
 * held out of the authenticated app so nobody reads or writes data mid-migration/deploy.
 * Platform admins always pass through -- they are the ones who enabled it and must be able to
 * reach /admin/settings to turn it back off.
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
