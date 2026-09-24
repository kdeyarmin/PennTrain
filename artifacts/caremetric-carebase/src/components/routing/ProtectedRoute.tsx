import { lazy, type ComponentType } from "react";
import { Link, Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { KioskLayout } from "@/components/layout/KioskLayout";
import { useAuth } from "@/lib/auth";
import { useProductModuleAccess } from "@/lib/productModuleAccess";
import { loginPathWithNext } from "@/lib/loginRedirect";
import { usePlatformStatus } from "@/hooks/usePlatformSettings";
import { shouldBlockForMaintenance } from "@/lib/maintenanceMode";
import { useVisibleFacilityTypes } from "@/hooks/useVisibleFacilityTypes";
import { facilityTypeLabel, hasAnyFacilityType } from "@/lib/facilityTypes";
export type UserRole = "platform_admin" | "org_admin" | "facility_manager" | "trainer" | "employee" | "auditor";

export function FullPageLoading({ label = "Loading CareMetric" }: { label?: string }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background" role="status" aria-live="polite">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

// Lazily loaded: it only renders while a platform admin has maintenance mode on, so keeping it
// out of the eager app shell (which the bundle budget watches closely) costs nothing in the
// overwhelmingly common non-maintenance case. Rendered under the Router's <Suspense> boundary.
const MaintenanceGate = lazy(() => import("@/components/layout/MaintenanceGate"));

// Wraps a data-bearing public/guest route (safety intake, kiosk check-in, evidence/move-in/
// resident-agreement portals, designated-person portal) so maintenance mode holds those tenant
// read/write flows too -- not just the authenticated app. Guests have no app role, so any confirmed
// maintenance blocks them (shouldBlockForMaintenance treats a missing role as non-admin). Fails open
// while status is unknown. Read-only public verification routes (/verify, /passport) stay open.
export function MaintenanceGatedRoute({ component: Component }: { component: ComponentType }) {
  const { data: platformStatus } = usePlatformStatus();
  if (shouldBlockForMaintenance(platformStatus?.maintenanceMode, undefined)) {
    return <MaintenanceGate showSignOut={false} />;
  }
  return <Component />;
}

// The end of the facility-type gate, for the case where there is nowhere left to send someone.
// Every regulatory page this gate protects (resident RASP/ASP tracking, medication-admin
// practicums, fire-drill logging, Survey Day) only has content for a Personal Care Home or an
// Assisted Living Facility, and an organization can be licensed for a module whose every page is
// gated that way. Saying so beats a redirect: the sidebar stays, so the pages they CAN open are
// one click away.
function FacilityTypeUnavailable({ requiredTypes }: { requiredTypes: readonly string[] }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-xl font-semibold">Not available for your facility types</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This page covers requirements that apply only to{" "}
        {requiredTypes.map((type) => facilityTypeLabel(type)).join(" and ")} sites, and your
        organization does not have one.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Add a facility of one of those types under Facilities, or use the navigation to open the
        pages available for the facilities you do have.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/app/facilities" className="rounded-md border px-4 py-2 text-sm font-medium">
          Facilities
        </Link>
        <Link href="/app/help" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Help &amp; support
        </Link>
      </div>
    </div>
  );
}

export function ProtectedRoute({
  component: Component,
  allowedRoles,
  requireFacilityTypes,
  chrome = "default",
}: {
  component: ComponentType;
  allowedRoles?: UserRole[];
  chrome?: "default" | "kiosk";
  // When set, the route is only reachable if the user has at least one facility of one of these
  // types (see useVisibleFacilityTypes) -- the route-level mirror of Sidebar.tsx hiding the nav
  // item, so directly navigating to the URL doesn't reach a page with nothing in it either.
  requireFacilityTypes?: readonly string[];
}) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const moduleAccess = useProductModuleAccess();
  const { facilityTypes, isLoading: facilityTypesLoading, isError: facilityTypesError } = useVisibleFacilityTypes();
  // Shares the cached ["platform-status"] query that MaintenanceBanner already runs, so this
  // adds no extra request. Fails open: `data` is undefined while loading and resolves to
  // maintenanceMode:false on any error, so the gate below only ever engages on a confirmed true.
  const { data: platformStatus } = usePlatformStatus();

  if (isLoading || moduleAccess.isLoading) {
    return <FullPageLoading />;
  }

  // Entitlement RPC failed with nothing to fall back on. `isError` is deliberately narrow (see
  // productModuleAccess.tsx): a failure that still has a last-good module set serves it and never
  // reaches here, because taking the whole app down to show a retry button is worse than running
  // one refresh cycle on the modules we last confirmed.
  if (moduleAccess.isError && isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-medium">Could not load your plan entitlements</p>
        <p className="max-w-md text-sm text-muted-foreground">
          A temporary error prevented CareBase from confirming which modules your organization can use.
          Retry to restore full access.
        </p>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => moduleAccess.refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    const loginPath = loginPathWithNext(window.location.pathname, window.location.search, window.location.hash);
    return <Redirect to={loginPath} />;
  }

  // Maintenance mode holds every non-platform-admin out of the authenticated app until a
  // platform admin turns it back off; admins pass through so they can reach /admin/settings and
  // do exactly that. Applied before the role/module checks so a maintenance user always lands on
  // the explanatory screen rather than being bounced between routes.
  if (shouldBlockForMaintenance(platformStatus?.maintenanceMode, user?.role)) {
    return <MaintenanceGate />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role as UserRole)) {
    if (user.role === "platform_admin") return <Redirect to="/admin" />;
    if (user.role === "org_admin" || user.role === "facility_manager" || user.role === "auditor") return <Redirect to="/app" />;
    if (user.role === "trainer") return <Redirect to="/trainer" />;
    if (user.role === "employee") return <Redirect to="/me" />;
    return <Redirect to="/login" />;
  }

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const currentPath = base && (window.location.pathname === base || window.location.pathname.startsWith(`${base}/`))
    ? window.location.pathname.slice(base.length) || "/"
    : window.location.pathname;
  if (user && !moduleAccess.canAccessPath(currentPath)) {
    return <Redirect to={moduleAccess.homePath ?? "/login"} />;
  }

  if (requireFacilityTypes && user) {
    if (facilityTypesLoading) {
      return <FullPageLoading label="Loading facility access" />;
    }
    // Only redirect on a confirmed non-match -- a query error isn't "confirmed no", and should
    // fail open (render the page) rather than silently bounce the user away with no explanation.
    // platform_admin always passes (useVisibleFacilityTypes returns every type).
    if (!facilityTypesError && !hasAnyFacilityType(facilityTypes, requireFacilityTypes)) {
      if (user.role === "trainer") return <Redirect to="/trainer" />;
      if (user.role === "employee") return <Redirect to="/me" />;
      if (user.role === "platform_admin") return <Redirect to="/admin" />;
      // Deliberately NOT "/app". Bare /app belongs to the CareBase module, so an organization
      // licensed for Compliance or Billing alone cannot reach it: the module gate above bounces it
      // to moduleAccess.homePath, which for those tiers is /app/inspection-readiness or
      // /app/resident-finance -- both PCH/ALF-only, both landing right back here. A tenant with no
      // Personal Care Home or Assisted Living Facility site got an infinite redirect instead of a
      // page. Going to the module home instead terminates after at most one hop, because the
      // second visit arrives with currentPath === homePath and falls through to the explanation.
      const moduleHome = moduleAccess.homePath;
      if (moduleHome && moduleHome !== currentPath) return <Redirect to={moduleHome} />;
      const unavailable = <FacilityTypeUnavailable requiredTypes={requireFacilityTypes} />;
      return chrome === "kiosk"
        ? <KioskLayout>{unavailable}</KioskLayout>
        : <MainLayout>{unavailable}</MainLayout>;
    }
  }

  const content = <Component />;
  return chrome === "kiosk"
    ? <KioskLayout>{content}</KioskLayout>
    : <MainLayout>{content}</MainLayout>;
}

