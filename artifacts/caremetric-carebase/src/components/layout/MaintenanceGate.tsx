import { useState } from "react";
import { AlertTriangle, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark, BrandName } from "@/components/brand/Logo";
import { useSignOut } from "@/lib/auth";

/**
 * Full-screen hold shown while maintenance_mode is enabled: to non-platform-admin users inside the
 * app (ProtectedRoute) and to visitors on data-bearing public/guest routes (MaintenanceGatedRoute).
 * Platform admins never reach the in-app gate -- they bypass it so they can turn maintenance off.
 *
 * "Check again" re-reads platform status (a plain reload; usePlatformStatus fails open and
 * re-fetches on mount) and lets the user straight back in once maintenance ends. "Sign out" is
 * shown only for signed-in users (`showSignOut`); it goes through the shared useSignOut() so an
 * impersonating admin's origin tokens, the query cache, and the Supabase runtime cache are all
 * cleared -- a raw supabase.auth.signOut() would strand the impersonation session in sessionStorage.
 */
export default function MaintenanceGate({ showSignOut = true }: { showSignOut?: boolean }) {
  const signOut = useSignOut();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // useSignOut() already surfaces its own errors; reload as a last resort so the user is
      // never stranded on this screen.
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50 px-4 py-10">
      <main className="w-full max-w-md space-y-7 text-center">
        <div className="flex flex-col items-center gap-3">
          <LogoMark className="h-14 w-14" />
          <div className="text-xl font-bold tracking-tight">
            <BrandName />
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-white p-7 shadow-xl shadow-black/[0.04]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">We&apos;ll be right back</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            CareBase is undergoing scheduled maintenance. Your account is safe and no data has been
            lost &mdash; access will return automatically as soon as maintenance is complete.
          </p>

          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <Button onClick={() => window.location.reload()} className="gap-2" disabled={signingOut}>
              <RefreshCw className="h-4 w-4" />
              Check again
            </Button>
            {showSignOut && (
              <Button
                variant="outline"
                onClick={handleSignOut}
                className="gap-2"
                disabled={signingOut}
              >
                <LogOut className="h-4 w-4" />
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground/70">
          Need help? Email{" "}
          <a href="mailto:hello@caremetric.ai" className="font-medium text-primary hover:underline">
            hello@caremetric.ai
          </a>
          .
        </p>
      </main>
    </div>
  );
}
