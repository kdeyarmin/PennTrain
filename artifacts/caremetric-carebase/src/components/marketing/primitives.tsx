import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, LogIn, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/** Presentational primitives shared across every public marketing page. */

/**
 * Reveals content on scroll — a single quiet fade/rise, not a barrage of
 * effects. Falls back to a static div for prefers-reduced-motion.
 *
 * Deliberately implemented with IntersectionObserver + a CSS transition instead
 * of framer-motion: this one fade/rise was the app's only framer-motion usage,
 * and the library cost ~120 KiB of eagerly-loaded JS (it is reachable from the
 * eager Landing page, so every visitor paid for it up front).
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Start hidden; flip to visible when the element scrolls into view (or
  // immediately when the environment can't/shouldn't animate).
  const [revealed, setRevealed] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (
      !element ||
      typeof IntersectionObserver === "undefined" ||
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      // No observer (old browser/jsdom) or reduced motion: render static content.
      setReduceMotion(true);
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      // Matches the previous framer-motion viewport margin of -60px.
      { rootMargin: "-60px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={
        reduceMotion
          ? undefined
          : {
              opacity: revealed ? 1 : 0,
              transform: revealed ? "none" : "translateY(14px)",
              transition: `opacity 0.5s ease-out ${delay}s, transform 0.5s ease-out ${delay}s`,
            }
      }
    >
      {children}
    </div>
  );
}

/** Faint blueprint grid used on the dark navy surfaces (hero, security, CTA). */
export function TechGrid({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 ${className}`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(to bottom, transparent, transparent 31px, rgba(255,255,255,0.05) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, rgba(255,255,255,0.05) 32px)",
      }}
    />
  );
}

/** Corner-bracketed icon badge -- a precision-instrument mark for the dark security cards. */
export function TechIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <span aria-hidden className="absolute left-0 top-0 h-2.5 w-2.5 border-l border-t border-[var(--mkt-accent)]/40" />
      <span aria-hidden className="absolute right-0 top-0 h-2.5 w-2.5 border-r border-t border-[var(--mkt-accent)]/40" />
      <span aria-hidden className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-[var(--mkt-accent)]/40" />
      <span aria-hidden className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-[var(--mkt-accent)]/40" />
      <Icon className="h-5 w-5 text-[var(--mkt-accent)]" />
    </div>
  );
}

/**
 * The dark navy banner that opens each dedicated marketing page, so Features,
 * Security, FAQ, etc. all share the landing page's hero surface treatment.
 */
export function PageHero({
  title,
  subtitle,
  eyebrow,
  highlights = [],
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: string;
  highlights?: string[];
}) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[var(--mkt-navy-900)] via-[var(--mkt-navy-800)] to-[var(--mkt-navy-700)] text-white">
      <TechGrid />
      <div className="absolute top-0 right-0 h-[420px] w-[420px] -translate-y-1/3 translate-x-1/4 rounded-full bg-[var(--mkt-accent)]/[0.10] blur-3xl" />
      <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8 lg:py-24">
        {eyebrow && (
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-[var(--mkt-accent-soft)]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {eyebrow}
          </div>
        )}
        <h1 className="mx-auto mt-5 max-w-3xl text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-white/70">
            {subtitle}
          </p>
        )}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" variant="secondary" className="gap-2">
            <Link href="/signup">
              Start a free trial
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="gap-2 border-white/20 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white"
          >
            <Link href="/demo">
              <LogIn className="h-4 w-4" />
              Demo Sign-In
            </Link>
          </Button>
        </div>
        {highlights.length > 0 && (
          <div className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-white/10 pt-6">
            {highlights.map((highlight) => (
              <div key={highlight} className="flex items-center gap-2 text-xs text-white/66">
                <CheckCircle2 className="h-3.5 w-3.5 text-[var(--mkt-accent)]" />
                {highlight}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
