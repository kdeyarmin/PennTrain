import type { ReactNode } from "react";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { IdleSessionLock } from "./SessionSecurityGates";

/**
 * IdleSessionLock is here, not only in MainLayout, or the kiosk idle timeout is dead code.
 *
 * SessionSecurityGates computes `isKiosk` from the path and reads
 * `kiosk_idle_timeout_minutes` (default 5, against 30 for an ordinary session) and locks with a
 * distinct `kiosk_timeout` reason -- but the lock only ever mounted inside MainLayout, and the one
 * route with `chrome="kiosk"` (`/trainer/classes/:id/kiosk`) renders THIS layout instead. So the
 * whole kiosk branch, its setting and its lock reason could never execute, and the shared
 * class-kiosk device -- the one most likely to be left unattended in a room full of people -- was
 * the only signed-in surface with no idle lock at all.
 *
 * Safe for any unauthenticated kiosk-style page too: the lock's own `lock()` returns early without
 * a user, so it degrades to a passive wrapper.
 */
export function KioskLayout({ children }: { children: ReactNode }) {
  return (
    <IdleSessionLock>
      <main id="main-content" className="min-h-screen bg-gradient-to-br from-background to-muted/40">
        <RouteErrorBoundary>{children}</RouteErrorBoundary>
      </main>
    </IdleSessionLock>
  );
}
