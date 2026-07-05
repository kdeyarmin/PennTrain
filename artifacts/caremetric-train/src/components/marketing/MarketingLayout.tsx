import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/marketing/primitives";
import { DEMO_MAILTO } from "@/components/marketing/content";
import { MARKETING_NAV } from "@/lib/publicPaths";

/** Wouter doesn't reset scroll between route changes -- do it ourselves. */
function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function MarketingHeader() {
  const [location] = useLocation();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5" data-testid="link-home">
          <LogoMark />
          <div className="flex flex-col leading-none">
            <span className="whitespace-nowrap text-[15px] font-bold tracking-tight">
              CareMetric Train
            </span>
            <span className="hidden whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:block">
              Compliance Training &amp; LMS
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {MARKETING_NAV.map((item) => {
            const active = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? "text-sm font-medium text-foreground"
                    : "text-sm font-medium text-muted-foreground hover:text-foreground"
                }
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm" data-testid="link-login">
              Log In
            </Button>
          </Link>
          <a href={DEMO_MAILTO}>
            <Button size="sm" data-testid="button-request-demo">
              Request a Demo
            </Button>
          </a>
        </div>
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
              <span className="text-sm font-bold">CareMetric Train</span>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              Compliance training and LMS for personal care homes, assisted living,
              group homes, nursing homes, home health, and hospice agencies.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Product
              </div>
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
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Account
              </div>
              <ul className="mt-3 space-y-2 text-sm">
                <li><Link href="/login" className="text-muted-foreground hover:text-foreground">Log In</Link></li>
                <li><a href={DEMO_MAILTO} className="text-muted-foreground hover:text-foreground">Request a Demo</a></li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                The CareMetric Family
              </div>
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

        <div className="mt-10 flex flex-col gap-2 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>&copy; {new Date().getFullYear()} CareMetric Train. All rights reserved.</span>
          <span className="font-mono tabular-nums text-muted-foreground/60">
            Rec. 2600-T &middot; Rev. {new Date().getFullYear()}.1
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
      <ScrollToTop />
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
}
