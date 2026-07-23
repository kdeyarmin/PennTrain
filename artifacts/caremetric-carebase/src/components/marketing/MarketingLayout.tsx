import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";
import { MARKETING_NAV } from "@/lib/publicPaths";
import { MarketingAIBot } from "@/components/marketing/MarketingAIBot";

/**
 * Wouter doesn't reset scroll between route changes -- handle it ourselves, in
 * a layout effect so the correction lands before paint (no visible jump).
 * Regular navigations scroll to the top (or, when the new URL carries a hash
 * -- e.g. a cross-page deep link to /features#resident-care -- scroll that
 * section into view) and move keyboard/screen-reader focus to the #main
 * landmark. Back/Forward (popstate) navigations instead restore the position
 * the visitor left that page at: browser scroll restoration is switched to
 * "manual" so it can't fight the pre-paint scrolling done here, and positions
 * are tracked per location in `savedScrollPositions`.
 *
 * Module-level (not ref) state: every marketing page mounts its own
 * MarketingLayout, so this component remounts on page-to-page navigation and
 * refs would be reset mid-navigation.
 *
 * scrollRestoration is a global browser setting, so it's put back to its
 * prior value once the visitor leaves the marketing surface entirely (last
 * instance unmounts) -- other window-scrolled pages (auth, public portals)
 * keep the browser's native Back/Forward behavior. The restore is deferred a
 * tick because a marketing-to-marketing navigation unmounts one instance and
 * mounts the next within the same commit.
 */
const savedScrollPositions = new Map<string, number>();
let isPopNavigation = false;
let isInitialLoad = true;
let scrollSaveKey = window.location.pathname;
let mountedInstances = 0;
let priorScrollRestoration: History["scrollRestoration"] | null = null;

// Registered once for the app session (module scope), not per mount: a Back
// press on a NON-marketing page (e.g. /signup) that lands on a marketing page
// fires popstate while no MarketingLayout is mounted -- a mount-scoped
// listener would miss it and the remounted layout would treat the navigation
// as fresh, scrolling a restored page to the top. This listener runs before
// wouter re-renders the new route (React flushes the state update after the
// popstate listeners finish), so the flag is always set by the time the
// layout effect below consumes it. It self-clears on the next macrotask so a
// pop navigation that never mounts a marketing layout (e.g. inside the
// logged-in app) can't leak a stale "restore" into a later marketing visit.
window.addEventListener("popstate", () => {
  isPopNavigation = true;
  setTimeout(() => {
    isPopNavigation = false;
  }, 0);
});

function ScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    mountedInstances += 1;
    if ("scrollRestoration" in window.history) {
      if (priorScrollRestoration === null) {
        priorScrollRestoration = window.history.scrollRestoration;
      }
      window.history.scrollRestoration = "manual";
    }
    // Mount-scoped on purpose (unlike the popstate listener above): while a
    // non-marketing page is showing, scrollSaveKey still holds the last
    // marketing location, and recording that page's scrolling would corrupt
    // the marketing page's saved position.
    const onScroll = () => {
      savedScrollPositions.set(scrollSaveKey, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      mountedInstances -= 1;
      setTimeout(() => {
        if (
          mountedInstances === 0 &&
          priorScrollRestoration !== null &&
          "scrollRestoration" in window.history
        ) {
          window.history.scrollRestoration = priorScrollRestoration;
          priorScrollRestoration = null;
        }
      }, 0);
    };
  }, []);

  useLayoutEffect(() => {
    const isPop = isPopNavigation;
    isPopNavigation = false;
    scrollSaveKey = location;

    if (isPop) {
      // Back/Forward: restore where the visitor left this page. Leave focus
      // alone -- pop navigations aren't a new reading context.
      window.scrollTo(0, savedScrollPositions.get(location) ?? 0);
      return;
    }

    const hash = window.location.hash;
    const target = hash && document.getElementById(hash.slice(1));
    if (target) {
      target.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }

    if (isInitialLoad) {
      // Full page load: the browser's own initial focus (document start) is
      // already correct -- don't steal it.
      isInitialLoad = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [location]);

  return null;
}

function MarketingHeader() {
  const [location] = useLocation();
  const { isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu on any route change.
  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5 min-w-0" data-testid="link-home">
          <LogoMark className="h-10 w-10" />
          <div className="flex flex-col leading-none min-w-0">
            <BrandName
              className="truncate text-[15px] font-bold tracking-tight"
              style={{ color: BRAND_BLUE }}
            />
            <span className="hidden whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:block">
              Operations &amp; Compliance Platform
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex xl:gap-8">
          {MARKETING_NAV.map((item) => {
            const active = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? "text-sm font-medium text-foreground"
                    : "text-sm font-medium text-foreground/75 hover:text-foreground"
                }
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Desktop actions */}
        <div className="hidden lg:flex items-center gap-2 shrink-0">
          {isAuthenticated ? (
            <Button asChild size="sm" data-testid="button-open-app">
              {/* "/" redirects signed-in visitors to their role's home. */}
              <Link href="/">Open CareBase</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" data-testid="link-login">
                <Link href="/login">Log In</Link>
              </Button>
              <Button asChild variant="outline" size="sm" data-testid="link-signup">
                <Link href="/signup">Sign Up</Link>
              </Button>
            </>
          )}
          <Button asChild size="sm" data-testid="button-request-demo">
            <Link href="/request-demo">Request a Demo</Link>
          </Button>
        </div>

        {/* Mobile menu */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[280px] max-w-[85vw]">
            <SheetTitle className="sr-only">Navigation menu</SheetTitle>
            <nav className="mt-8 flex flex-col gap-1">
              {MARKETING_NAV.map((item) => {
                const active = location === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium",
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-6 flex flex-col gap-2 border-t border-border/60 pt-6">
              {isAuthenticated ? (
                <Button asChild className="w-full">
                  <Link href="/" onClick={() => setMenuOpen(false)}>
                    Open CareBase
                  </Link>
                </Button>
              ) : (
                <>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/login" onClick={() => setMenuOpen(false)}>
                      Log In
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/signup" onClick={() => setMenuOpen(false)}>
                      Sign Up
                    </Link>
                  </Button>
                </>
              )}
              <Button asChild className="w-full">
                <Link href="/request-demo" onClick={() => setMenuOpen(false)}>
                  Request a Demo
                </Link>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <Link href="/" className="flex items-center gap-2.5">
              <LogoMark className="h-8 w-8" />
              <BrandName className="text-sm font-bold" style={{ color: BRAND_BLUE }} />
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              Operations, workforce compliance, and survey-readiness software built
              first for personal care homes and assisted living facilities.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Product
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {MARKETING_NAV.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="text-muted-foreground hover:text-foreground">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Account
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                <li><Link href="/login" className="text-muted-foreground hover:text-foreground">Log In</Link></li>
                <li><Link href="/signup" className="text-muted-foreground hover:text-foreground">Sign Up</Link></li>
                <li><Link href="/request-demo" className="text-muted-foreground hover:text-foreground">Request a Demo</Link></li>
              </ul>
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                The CareMetric Family
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <a href="https://caremetric.ai" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                    CareMetric AI
                  </a>
                </li>
                <li>
                  <a href="https://cmbreathe.com" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                    CareMetric Breathe
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-border/60 pt-6 text-xs text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} CareMetric CareBase. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}

/** Shared chrome (header + footer) wrapping every public marketing page. */
export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <ScrollToTop />
      <MarketingHeader />
      {/* tabIndex={-1} lets ScrollToTop move focus here after navigation. */}
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <MarketingFooter />
      <MarketingAIBot />
    </div>
  );
}
