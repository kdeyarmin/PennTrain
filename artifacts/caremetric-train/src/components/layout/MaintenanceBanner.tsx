import { AlertTriangle } from "lucide-react";
import { usePlatformStatus } from "@/hooks/usePlatformSettings";

// Mounted near the app root (outside/above the authenticated MainLayout) by whoever wires it up,
// so it shows on both public and authenticated pages. Mirrors the visual weight of
// ImpersonationBanner in MainLayout.tsx but uses usePlatformStatus(), which is safe to call
// pre-auth and fails open, so this never blocks rendering the rest of the app.
export default function MaintenanceBanner() {
  const { data: status } = usePlatformStatus();

  if (!status?.maintenanceMode) return null;

  return (
    <div className="bg-amber-500 text-amber-950 px-4 sm:px-6 py-2.5 flex items-center gap-2 text-sm font-medium">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>Maintenance mode is enabled -- some features may be limited.</span>
    </div>
  );
}
