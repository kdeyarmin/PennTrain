import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LogoMark, BrandName } from "@/components/brand/Logo";
import { MARKETING_NAV, MARKETING_SECONDARY_NAV } from "@/lib/publicPaths";

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
 * Header navigation: page routes from MARKETING_NAV interleaved with the two
 * landing-page section anchors the design calls for. Hash links are plain
 * anchors on purpose -- on the landing page the browser's native anchor scroll
 * handles them, and from any other page the full navigation lands on "/" with
 * the hash, which ScrollToTop scrolls into view.
 */
const HEADER_NAV: ReadonlyArray<{ href: string; label: string; hash?: boolean }> = [
  { href: "/#platform", label: "Platform", hash: true },
  { href: "/how-it-works", label: "How it works" },
  { href: "/features", label: "Features" },
  { href: "/#pricing", label: "Pricing", hash: true },
  { href: "/savings", label: "Savings" },
  { href: "/requirements", label: "Requirements" },
  { href: "/faq", label: "FAQ" },
  { href: "/about", label: "About" },
];

function MarketingHeader() {
  const [location] = useLocation();
  const { isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu on any route change.
  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  const navLink = (item: (typeof HEADER_NAV)[number], className: string) => {
    const active = !item.hash && location === item.href;
    const cls = cn(className, active ? "text-[#0d2742]" : "text-[#44566b] hover:text-[#0d2742]");
    return item.hash ? (
      <a key={item.href} href={item.href} className={cls} onClick={() => setMenuOpen(false)}>
        {item.label}
      </a>
    ) : (
      <Link
        key={item.href}
        href={item.href}
        className={cls}
        aria-current={active ? "page" : undefined}
        onClick={() => setMenuOpen(false)}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#e5eaf0] bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between gap-4 px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5" data-testid="link-home">
          <LogoMark className="h-9 w-9" />
          <span className="flex min-w-0 flex-col leading-tight">
            <BrandName className="truncate text-[15px] font-extrabold" style={{ color: "#0d2742" }} />
            <span className="hidden whitespace-nowrap text-[11px] font-semibold text-[#5d7084] sm:block">
              PCH &amp; ALF operations
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-[18px] lg:flex">
          {HEADER_NAV.map((item) => navLink(item, "whitespace-nowrap text-sm font-semibold"))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden shrink-0 items-center gap-2.5 lg:flex">
          {isAuthenticated ? (
            <Link
              href="/"
              className="whitespace-nowrap rounded-lg bg-[#1b6fc2] px-4 py-[9px] text-sm font-bold text-white hover:bg-[#14548f]"
              data-testid="button-open-app"
            >
              {/* "/" redirects signed-in visitors to their role's home. */}
              Open CareBase
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-[#44566b] hover:text-[#0d2742]"
                data-testid="link-login"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="whitespace-nowrap rounded-lg bg-[#1b6fc2] px-4 py-[9px] text-sm font-bold text-white hover:bg-[#14548f]"
                data-testid="link-signup"
              >
                Start free trial
              </Link>
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
          <SheetContent side="right" className="w-[280px] max-w-[85vw] bg-white">
            <SheetTitle className="sr-only">Navigation menu</SheetTitle>
            <nav className="mt-8 flex flex-col gap-1">
              {HEADER_NAV.map((item) =>
                navLink(item, "rounded-md px-3 py-2 text-sm font-semibold"),
              )}
            </nav>
            <div className="mt-6 flex flex-col gap-2 border-t border-[#e5eaf0] pt-6">
              {isAuthenticated ? (
                <Link
                  href="/"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg bg-[#1b6fc2] px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-[#14548f]"
                >
                  Open CareBase
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-lg border border-[#c8d4e0] px-4 py-2.5 text-center text-sm font-bold text-[#0d2742] hover:bg-[#f0f5fa]"
                  >
                    Log in
                  </Link>
                  <Link
                    href="/signup"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-lg bg-[#1b6fc2] px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-[#14548f]"
                  >
                    Start free trial
                  </Link>
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
  return (
    <footer className="border-t border-white/10 bg-[#071626] text-[12.5px] text-white/70">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-4 px-6 py-5">
        <span>&copy; {new Date().getFullYear()} CareMetric CareBase. All rights reserved.</span>
        <span className="flex flex-wrap gap-[18px]">
          <Link href="/" className="text-white/70 hover:text-white">
            Home
          </Link>
          {MARKETING_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-white/70 hover:text-white">
              {item.label}
            </Link>
          ))}
          {MARKETING_SECONDARY_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-white/70 hover:text-white">
              {item.label}
            </Link>
          ))}
        </span>
      </div>
    </footer>
  );
}

/** Shared chrome (header + footer) wrapping every public marketing page. */
export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="cb-marketing min-h-screen w-full bg-white">
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
