import type { ReactNode } from "react";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { IdleSessionLock, MfaPolicyGate } from "./SessionSecurityGates";

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
 *
 * MfaPolicyGate is here for the same reason (BACKLOG.md I14). It wrapped MainLayout only, so the
 * one route rendering this layout -- a trainer running a class kiosk on a shared device in a room
 * full of people -- was the single signed-in surface an organization's MFA policy did not reach.
 * The gate degrades the same way when no policy requires a factor.
 */
export function KioskLayout({ children }: { children: ReactNode }) {
  return (
    <MfaPolicyGate>
      <IdleSessionLock>
        <main id="main-content" className="min-h-screen bg-gradient-to-br from-background to-muted/40">
          <RouteErrorBoundary>{children}</RouteErrorBoundary>
        </main>
      </IdleSessionLock>
    </MfaPolicyGate>
  );
}
