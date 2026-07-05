import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";
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
              Compliance Training Platform
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

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
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

        {/* Mobile menu */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 md:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[280px] max-w-[85vw]">
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
              <Link href="/login" onClick={() => setMenuOpen(false)}>
                <Button variant="outline" className="w-full">
                  Log In
                </Button>
              </Link>
              <a href={DEMO_MAILTO} onClick={() => setMenuOpen(false)}>
                <Button className="w-full">Request a Demo</Button>
              </a>
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
              Compliance training platform for personal care homes, assisted living,
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
            Rev. {new Date().getFullYear()}.1
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
