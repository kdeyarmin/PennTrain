import { useEffect, useState } from "react";
import { useAuth, useSignOut } from "@/lib/auth";
import { useMyOrganizationAccessible } from "@/hooks/useOrganizations";
import { useImpersonationStatus, useStopImpersonation } from "@/hooks/useImpersonation";
import { Sidebar, MobileSidebar } from "./Sidebar";
import { Header } from "./Header";
import { Loader2, Eye, X, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

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

function SuspendedScreen() {
  const handleLogout = useSignOut();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <div className="max-w-md text-center space-y-4">
        <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <ShieldAlert className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="text-xl font-bold">Organization Access Suspended</h1>
        <p className="text-muted-foreground text-sm">
          Your organization's access to CareMetric Train has been suspended. Contact your administrator or
          CareMetric Train support to resolve this.
        </p>
        <Button variant="outline" onClick={handleLogout}>Sign Out</Button>
      </div>
    </div>
  );
}

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // A suspended org's current_org_id() resolves to null (see
  // 20260706043604_org_suspension_enforcement_and_limits.sql), so RLS blocks a non-platform_admin
  // member from reading their own organizations row -- that absence is the suspension signal.
  const checkSuspension = isAuthenticated && !!user && user.role !== "platform_admin" && !!user.organizationId;
  const { data: orgAccessible, isLoading: suspensionLoading } = useMyOrganizationAccessible(user?.organizationId, checkSuspension);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (checkSuspension && suspensionLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (checkSuspension && orgAccessible === false) {
    return <SuspendedScreen />;
  }

  return (
    <div className="flex min-h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <MobileSidebar open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
      <div className="flex-1 flex flex-col min-w-0">
        <ImpersonationBanner />
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-auto bg-background">
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
