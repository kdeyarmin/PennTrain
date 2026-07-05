import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ShieldCheck, type LucideIcon } from "lucide-react";

/** Presentational primitives shared across every public marketing page. */

export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <div
      className={`${className} rounded-xl bg-gradient-to-br from-primary to-[#0f3f92] flex items-center justify-center shadow-sm shrink-0`}
    >
      <ShieldCheck className="h-[55%] w-[55%] text-primary-foreground" />
    </div>
  );
}

/**
 * Reveals content on scroll -- a single quiet fade/rise, not a barrage of
 * effects. Falls back to a static div for prefers-reduced-motion.
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
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
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
      <span aria-hidden className="absolute left-0 top-0 h-2.5 w-2.5 border-l border-t border-[#59b2ff]/40" />
      <span aria-hidden className="absolute right-0 top-0 h-2.5 w-2.5 border-r border-t border-[#59b2ff]/40" />
      <span aria-hidden className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-[#59b2ff]/40" />
      <span aria-hidden className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-[#59b2ff]/40" />
      <Icon className="h-5 w-5 text-[#59b2ff]" />
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
}: {
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[#0a1a2e] via-[#102a43] to-[#16324f] text-white">
      <TechGrid />
      <div className="absolute top-0 right-0 h-[420px] w-[420px] -translate-y-1/3 translate-x-1/4 rounded-full bg-[#59b2ff]/[0.10] blur-3xl" />
      <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8 lg:py-24">
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-white/70">
            {subtitle}
          </p>
        )}
      </div>
    </section>
  );
}
