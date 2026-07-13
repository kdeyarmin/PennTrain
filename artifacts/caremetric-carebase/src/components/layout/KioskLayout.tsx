import type { ReactNode } from "react";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";

export function KioskLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="min-h-screen bg-gradient-to-br from-background to-muted/40">
      <RouteErrorBoundary>{children}</RouteErrorBoundary>
    </main>
  );
}
