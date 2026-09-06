import { useEffect, useRef, useState } from "react";
import { useAuth, useSignOut } from "@/lib/auth";
import { useMyOrganizationAccessible } from "@/hooks/useOrganizations";
import { useImpersonationStatus, useStopImpersonation } from "@/hooks/useImpersonation";
import { Sidebar, MobileSidebar } from "./Sidebar";
import { Header } from "./Header";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { Loader2, Eye, X, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { IdleSessionLock, MfaPolicyGate, useCurrentIdleSessionLock } from "./SessionSecurityGates";
import { OfflineSyncManager } from "@/components/offline/OfflineSyncManager";
import { useNavigationWorkspace } from "@/hooks/useProductExperience";
import { CareMetricCopilot } from "@/components/CareMetricCopilot";
import { EndUserExperiencePanel } from "./EndUserExperiencePanel";
import { PageTitleProvider, registryLabelForPath } from "@/lib/pageTitle";

// Impersonation sessions auto-return after this long as a defense-in-depth backstop, independent
// of the underlying magic-link JWT's own expiry (see useImpersonation.ts).
const IMPERSONATION_SOFT_TIMEOUT_MS = 30 * 60 * 1000;

function ImpersonationBanner() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isImpersonating, target, startedAt } = useImpersonationStatus();
  const { mutate: stopImpersonation, isPending: stopping } = useStopImpersonation();

  const handleExit = () => {
    stopImpersonation(undefined, {
      onSuccess: () => navigate("/admin"),
      onError: (e: Error) => toast({ title: "Failed to exit impersonation", description: e.message, variant: "destructive" }),
    });
  };

  useEffect(() => {
    if (!isImpersonating || !startedAt) return;
    const elapsed = Date.now() - new Date(startedAt).getTime();
    const remaining = IMPERSONATION_SOFT_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      handleExit();
      return;
    }
    const timer = setTimeout(handleExit, remaining);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImpersonating, startedAt]);

  if (!isImpersonating || !target) return null;

  return (
    <div className="bg-amber-500 text-amber-950 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-2 text-sm font-medium">
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="h-4 w-4 shrink-0" />
        <span className="truncate">
          Impersonating <strong>{target.firstName} {target.lastName}</strong> ({target.email})
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-amber-950 hover:bg-amber-400"
        onClick={handleExit}
        disabled={stopping}
      >
        <X className="h-4 w-4 mr-1" />
        Return to Admin
      </Button>
    </div>
  );
}

// `current_org_id()` excludes BOTH 'suspended' and 'canceled' (20260716224753), and the probe
// below can only see that the organization row has become unreadable -- the row itself, which is
// where the status lives, is exactly what RLS is withholding. So this screen cannot honestly name
// one of the two, and used to name the wrong one for every canceled organization. It says what is
// actually known, and both routes out of it are true for either status.
function SuspendedScreen() {
  const handleLogout = useSignOut();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <div className="max-w-md text-center space-y-4">
        <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <ShieldAlert className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="text-xl font-bold">Organization Access Unavailable</h1>
        <p className="text-muted-foreground text-sm">
          Your organization's CareMetric CareBase subscription is suspended or canceled, so its records are not
          available to you right now. Your data is not deleted. Contact your organization administrator, or
          CareMetric CareBase support, to restore access.
        </p>
        <Button variant="outline" onClick={handleLogout}>Sign Out</Button>
      </div>
    </div>
  );
}

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const { isImpersonating } = useImpersonationStatus();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [location] = useLocation();
  const navigation = useNavigationWorkspace();
  const lastRecordedPath = useRef<string | null>(null);

  useEffect(() => {
    const path = location.split(/[?#]/, 1)[0];
    if (!user || lastRecordedPath.current === path || !/^\/(admin|app|trainer|me|account)(\/|$)/.test(path)) return;
    lastRecordedPath.current = path;
    // Prefer the shared registry label so "Recents" reads "Incident detail", not a raw UUID or a
    // title-cased last segment; fall back to the old munging for any route not in the registry.
    const label = registryLabelForPath(path)
      ?? path.split("/").filter(Boolean).at(-1)?.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
      ?? "Dashboard";
    navigation.recordVisit.mutate({ path, label });
  }, [location, navigation.recordVisit, user]);

  // A suspended org's current_org_id() resolves to null (see
  // 20260706043604_org_suspension_enforcement_and_limits.sql), so RLS blocks a non-platform_admin
  // member from reading their own organizations row -- that absence is the suspension signal.
  const checkSuspension = isAuthenticated && !!user && user.role !== "platform_admin" && !!user.organizationId;
  const { data: orgAccessible, isLoading: suspensionLoading } = useMyOrganizationAccessible(user?.organizationId, checkSuspension);

  // ...but so does a session the server has locked: `current_org_id()` is
  // `... and public.current_session_unlocked()`, so an idle or kiosk lock makes that same row
  // unreadable. A user whose session locked and who then reloaded the tab therefore got the
  // full-page suspension screen -- whose only control is Sign Out -- and the unlock prompt one
  // level down never mounted. The lock has to be resolved before "unreadable" can be read as
  // "suspended"; when it is not resolved (still loading, or the probe itself failed) fall through
  // to IdleSessionLock, which owns both the prompt and its own fail-closed screen.
  const sessionLock = useCurrentIdleSessionLock(user?.id);
  const sessionNotLocked = sessionLock.isSuccess && sessionLock.data === null;

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (checkSuspension && (suspensionLoading || sessionLock.isPending)) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Loading organization access…</span>
      </div>
    );
  }

  // Never show the blocking suspended-org screen while impersonating -- it would render before
  // Sidebar/ImpersonationBanner ever mount, trapping the admin as the target user with no visible
  // way back to their own session (see the P2 review finding this comment documents). Falling
  // through to the normal layout instead keeps "Return to Admin" reachable; the impersonated
  // user's pages will simply show no data, same as any other suspended-org browsing session.
  if (checkSuspension && orgAccessible === false && !isImpersonating && sessionNotLocked) {
    return <SuspendedScreen />;
  }

  return (
    // The banner, and the 30-minute auto-return timer it owns, sit ABOVE MfaPolicyGate on purpose.
    // Inside it, an administrator impersonating a manager in an MFA-required tenant met the
    // full-screen "Multi-factor verification required" gate -- the impersonated session is that
    // manager's, and it is not AAL2 -- with the exit rendered underneath it and therefore not on
    // screen at all. Out here the way back is always visible, and the timer keeps running whichever
    // gate is showing.
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <ImpersonationBanner />
      <div className="min-h-0 flex-1 overflow-auto">
    <MfaPolicyGate>
    <IdleSessionLock>
    <PageTitleProvider>
    <div className="flex h-full w-full overflow-hidden bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground">
        Skip to main content
      </a>
      <Sidebar />
      <MobileSidebar open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Owns the offline draft sync loop for the whole signed-in session, and renders the
            critical-reading warning a background sync can raise. In the shell rather than on a
            page because the pages that used to carry it are not the ones a caregiver sits on while
            a draft is waiting -- BACKLOG.md open question 7a. Its own boundary: a crash in the
            sync loop must not blank the app chrome. */}
        <RouteErrorBoundary>
          <OfflineSyncManager />
        </RouteErrorBoundary>
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto bg-background focus:outline-none">
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {/* Own boundary: a crash in the guidance panel must never blank the
                route content (and vice versa) -- previously it rendered outside
                any error boundary entirely. */}
            <RouteErrorBoundary>
              <EndUserExperiencePanel />
            </RouteErrorBoundary>
            <RouteErrorBoundary>{children}</RouteErrorBoundary>
          </div>
        </main>
        <CareMetricCopilot />
      </div>
    </div>
    </PageTitleProvider>
    </IdleSessionLock>
    </MfaPolicyGate>
      </div>
    </div>
  );
}
