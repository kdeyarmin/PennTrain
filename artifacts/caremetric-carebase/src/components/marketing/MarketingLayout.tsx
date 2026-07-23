import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";
import { MARKETING_NAV, stripBase } from "@/lib/publicPaths";

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

/**
 * wouter only re-renders when the pathname changes, so clicking a landing-page
 * hash link (e.g. "/#pricing") while already on "/" would be a no-op: pushState
 * updates the hash but ScrollToTop never re-runs. This handler catches the
 * same-page case and performs the scroll itself; cross-page navigations fall
 * through to wouter, whose route change triggers ScrollToTop's hash handling.
 */
function hashNavClickHandler(href: string): ((event: React.MouseEvent) => void) | undefined {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) return undefined;
  const targetPath = href.slice(0, hashIndex) || "/";
  const targetId = href.slice(hashIndex + 1);
  return (event) => {
    if (stripBase(window.location.pathname) !== targetPath) return;
    event.preventDefault();
    window.history.pushState(null, "", href);
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth" });
  };
}

/** A header/footer nav link that supports landing-page hash targets. */
function NavAnchorLink({
  href,
  className,
  children,
  onNavigate,
  "aria-current": ariaCurrent,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  onNavigate?: () => void;
  "aria-current"?: "page";
}) {
  const hashClick = hashNavClickHandler(href);
  return (
    <Link
      href={href}
      className={className}
      aria-current={ariaCurrent}
      onClick={(event) => {
        hashClick?.(event);
        onNavigate?.();
      }}
    >
      {children}
    </Link>
  );
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
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 min-w-0" data-testid="link-home">
          <LogoMark className="h-9 w-9" />
          <div className="flex flex-col leading-tight min-w-0">
            <BrandName
              className="truncate text-[15px] font-extrabold tracking-tight"
              style={{ color: BRAND_BLUE }}
            />
            <span className="hidden whitespace-nowrap text-[11px] font-semibold text-muted-foreground sm:block">
              PCH &amp; assisted living operations
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-5 lg:flex" aria-label="Primary">
          {MARKETING_NAV.map((item) => {
            const active = location === item.href;
            return (
              <NavAnchorLink
                key={item.href}
                href={item.href}
                className={
                  active
                    ? "whitespace-nowrap text-sm font-semibold text-foreground"
                    : "whitespace-nowrap text-sm font-semibold text-foreground/70 hover:text-foreground"
                }
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </NavAnchorLink>
            );
          })}
        </nav>

        {/* Desktop actions */}
        <div className="hidden lg:flex items-center gap-3 shrink-0">
          {isAuthenticated ? (
            <Button asChild size="sm" data-testid="button-open-app">
              {/* "/" redirects signed-in visitors to their role's home. */}
              <Link href="/">Open CareBase</Link>
            </Button>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-semibold text-foreground/70 hover:text-foreground"
                data-testid="link-login"
              >
                Log In
              </Link>
              <Button asChild size="sm" data-testid="link-signup">
                <Link href="/signup">Start free trial</Link>
              </Button>
            </>
          )}
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
                  <NavAnchorLink
                    key={item.href}
                    href={item.href}
                    onNavigate={() => setMenuOpen(false)}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium",
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    {item.label}
                  </NavAnchorLink>
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
                  <Button asChild className="w-full">
                    <Link href="/signup" onClick={() => setMenuOpen(false)}>
                      Start free trial
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

function MarketingFooter() {
  const footerLink = "text-white/75 hover:text-white hover:underline";
  return (
    <footer className="bg-[#071626] text-white/75">
      <div className="mx-auto max-w-[1160px] px-4 pb-8 pt-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="flex flex-col gap-2.5">
            <Link href="/" className="flex items-center gap-2.5">
              <LogoMark className="h-8 w-8" />
              {/* Not BrandName: its fixed two-tone gray fails contrast on the dark footer. */}
              <span className="text-sm font-extrabold text-white">CareMetric CareBase</span>
            </Link>
            <p className="max-w-[34ch] text-[13px] text-white/70">
              Operations, compliance, and survey readiness for personal care
              homes and assisted living facilities.
            </p>
          </div>

          <div className="flex flex-col gap-2 text-[13.5px]">
            <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.1em] text-white/60">
              PRODUCT
            </h2>
            <NavAnchorLink href="/#platform" className={footerLink}>Platform</NavAnchorLink>
            <Link href="/how-it-works" className={footerLink}>How it works</Link>
            <Link href="/savings" className={footerLink}>Savings</Link>
            <Link href="/pa-training-requirements" className={footerLink}>PA requirements guide</Link>
            <NavAnchorLink href="/#pricing" className={footerLink}>Pricing</NavAnchorLink>
            <Link href="/faq" className={footerLink}>FAQ</Link>
            <Link href="/security" className={footerLink}>Security</Link>
          </div>

          <div className="flex flex-col gap-2 text-[13.5px]">
            <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.1em] text-white/60">
              ACCOUNT
            </h2>
            <Link href="/login" className={footerLink}>Log in</Link>
            <Link href="/signup" className={footerLink}>Start free trial</Link>
            <Link href="/request-demo" className={footerLink}>Request a demo</Link>
          </div>

          <div className="flex flex-col gap-2 text-[13.5px]">
            <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.1em] text-white/60">
              COMPANY
            </h2>
            <Link href="/about" className={footerLink}>About CareBase</Link>
            <a href="https://caremetric.ai" target="_blank" rel="noreferrer" className={footerLink}>
              CareMetric AI
            </a>
            <a href="https://cmbreathe.com" target="_blank" rel="noreferrer" className={footerLink}>
              CareMetric Breathe
            </a>
          </div>
        </div>

        <div className="mt-9 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5 text-[12.5px] text-white/65">
          <span>&copy; {new Date().getFullYear()} CareMetric CareBase. All rights reserved.</span>
          <span className="flex gap-4">
            <Link href="/privacy" className={footerLink}>Privacy Policy</Link>
            <Link href="/terms" className={footerLink}>Terms of Service</Link>
          </span>
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
    </div>
  );
}
