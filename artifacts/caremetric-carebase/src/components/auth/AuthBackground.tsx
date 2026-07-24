/**
 * Shared premium backdrop for the auth pages (login, signup, demo, password reset). A soft
 * brand gradient, a faint blueprint grid masked to fade at the edges, and two blurred glows —
 * the light-surface echo of the marketing hero's "precision instrument" treatment, so the
 * first authenticated impression matches the public site.
 */
export function AuthBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent, transparent 31px, hsl(var(--primary) / 0.045) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, hsl(var(--primary) / 0.045) 32px)",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%)",
        }}
      />
      <div className="absolute right-0 top-0 h-[600px] w-[600px] -translate-y-1/2 translate-x-1/4 rounded-full bg-primary/[0.04] blur-3xl" />
      <div className="absolute bottom-0 left-0 h-[400px] w-[400px] -translate-x-1/4 translate-y-1/3 rounded-full bg-blue-500/[0.04] blur-3xl" />
    </div>
  );
}
