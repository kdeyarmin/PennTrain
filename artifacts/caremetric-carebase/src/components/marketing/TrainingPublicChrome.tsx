import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";
import { useAuth } from "@/lib/auth";

export function TrainingPublicHeader() {
  const { isAuthenticated } = useAuth();
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="CareMetric Train home">
          <LogoMark className="h-9 w-9" />
          <BrandName product="Train" className="text-lg font-bold" style={{ color: BRAND_BLUE }} />
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-3">
          {isAuthenticated ? (
            <Button asChild><Link href="/">Open training</Link></Button>
          ) : (
            <>
              <Button asChild variant="ghost"><Link href="/login">Sign in</Link></Button>
              <Button asChild><Link href="/signup?product=train">Set up a facility</Link></Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function TrainingPublicFooter() {
  const [location] = useLocation();
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 text-sm sm:px-6">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-3">
          {[
            { href: "/", label: "Training overview" },
            { href: "/privacy", label: "Privacy" },
            { href: "/terms", label: "Terms" },
            { href: "/security", label: "Security" },
            { href: "/legal/facility-signup", label: "Facility agreements" },
          ].map(({ href, label }) => (
            <Link key={href} href={href} aria-current={location === href ? "page" : undefined} className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">{label}</Link>
          ))}
          <a href="https://cmcarebase.com/" className="hover:underline">Explore CareMetric modules</a>
          <a href="https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-training" className="hover:underline">DHS training information</a>
        </nav>
        <p className="text-xs text-foreground/80">&copy; {new Date().getFullYear()} CareMetric Train. All rights reserved.</p>
      </div>
    </footer>
  );
}
