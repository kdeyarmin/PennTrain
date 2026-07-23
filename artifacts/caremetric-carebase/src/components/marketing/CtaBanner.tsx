import { Link } from "wouter";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal, TechGrid } from "@/components/marketing/primitives";

/**
 * The closing call-to-action banner. Shared by the landing page (where it
 * anchors #contact) and every dedicated marketing page. Self-service only —
 * primary starts the trial, secondary routes to the FAQ, never a human handoff.
 */
export function CtaBanner({
  id,
  title = "Ready to replace scattered trackers with one accountable operation?",
  subtitle = "Start the free trial, import your roster, and see exactly what CareMetric CareBase consolidates and what stays connected — no call required.",
}: {
  id?: string;
  title?: string;
  subtitle?: string;
}) {
  return (
    <section
      id={id}
      className="relative overflow-hidden bg-gradient-to-br from-[#0a1a2e] via-[#102a43] to-[#16324f] text-white"
    >
      <TechGrid />
      <div className="absolute inset-0 opacity-20 [background:radial-gradient(circle_at_top_right,#59b2ff,transparent_60%)]" />
      <Reveal className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          {title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-white/70">{subtitle}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" variant="secondary" data-testid="button-cta-signup">
            <Link href="/signup">Start a Free Trial</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="gap-2 border-white/30 bg-transparent text-white hover:bg-white/10"
            data-testid="button-cta-faq"
          >
            <Link href="/faq">
              <Mail className="h-4 w-4" />
              Questions? Read the FAQ
            </Link>
          </Button>
        </div>
      </Reveal>
    </section>
  );
}
