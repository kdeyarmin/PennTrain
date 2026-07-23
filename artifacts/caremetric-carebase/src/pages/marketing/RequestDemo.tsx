import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Mail, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { DEMO_MAILTO } from "@/components/marketing/content";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { useRequestDemo } from "@/hooks/useRequestDemo";
import { usePageMeta } from "@/lib/usePageMeta";

const WHAT_TO_EXPECT = [
  "A walkthrough mapped to your facility type and current workflow — not a canned slideshow.",
  "Straight answers on how CareBase handles Chapter 2600 and 2800 requirements, and on what it deliberately does not replace.",
  "A dedicated demo login with sample facility data, on request, so you can explore on your own afterward.",
];

/**
 * Returns the same-origin path the visitor came from, so the demo request
 * records which page actually converted. Cross-origin referrers are dropped.
 */
function referrerPath(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    const url = new URL(document.referrer);
    if (url.origin !== window.location.origin) return undefined;
    return url.pathname;
  } catch {
    return undefined;
  }
}

export default function RequestDemo() {
  usePageMeta({ ...MARKETING_ROUTE_META["/request-demo"], path: "/request-demo" });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [facilityCount, setFacilityCount] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const sourcePathRef = useRef<string | undefined>(undefined);
  const { toast } = useToast();
  const { mutate: requestDemo, isPending } = useRequestDemo();
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    sourcePathRef.current = referrerPath();
  }, []);

  // Same explicit-render Turnstile lifecycle as Signup.tsx — the global
  // `window.turnstile` typing is declared there.
  useEffect(() => {
    if (!turnstileSiteKey) return;
    let cancelled = false;

    const renderTurnstile = () => {
      if (cancelled || !window.turnstile || !turnstileContainerRef.current || turnstileWidgetIdRef.current) return;
      turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token) => {
          setTurnstileToken(token);
          setTurnstileError(null);
        },
        "expired-callback": () => {
          setTurnstileToken("");
          setTurnstileError("Verification expired. Please complete it again.");
        },
        "error-callback": () => {
          setTurnstileToken("");
          setTurnstileError("Verification could not load for this domain. Refresh the page or email us instead.");
        },
      });
    };

    if (window.turnstile) {
      renderTurnstile();
    } else {
      const scriptId = "cloudflare-turnstile-api";
      let script = document.getElementById(scriptId) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.id = scriptId;
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderTurnstile);
      const handleScriptError = () =>
        setTurnstileError("Verification could not load. Check your connection and refresh the page.");
      script.addEventListener("error", handleScriptError);
      return () => {
        cancelled = true;
        script?.removeEventListener("load", renderTurnstile);
        script?.removeEventListener("error", handleScriptError);
        if (turnstileWidgetIdRef.current) window.turnstile?.remove?.(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = null;
      };
    }

    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current) window.turnstile?.remove?.(turnstileWidgetIdRef.current);
      turnstileWidgetIdRef.current = null;
    };
  }, [turnstileSiteKey]);

  const resetTurnstile = () => {
    if (turnstileWidgetIdRef.current) window.turnstile?.reset(turnstileWidgetIdRef.current);
    setTurnstileToken("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast({ variant: "destructive", title: "Name and work email are required" });
      return;
    }
    if (!turnstileToken) {
      setTurnstileError("Please complete the verification below.");
      return;
    }
    const parsedCount = Number.parseInt(facilityCount, 10);
    requestDemo(
      {
        name: name.trim(),
        email: email.trim(),
        organization: organization.trim(),
        facilityCount: Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : undefined,
        message: message.trim(),
        sourcePath: sourcePathRef.current,
        turnstileToken,
      },
      {
        onSuccess: () => setSubmitted(true),
        onError: (error) => {
          resetTurnstile();
          toast({
            variant: "destructive",
            title: "Could not send your request",
            description:
              error instanceof Error && error.message
                ? error.message
                : "Something went wrong. Try again, or email hello@caremetric.ai.",
          });
        },
      },
    );
  };

  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0a1a2e] via-[#102a43] to-[#16324f] text-white">
        <TechGrid />
        <div className="relative mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <h1 className="mx-auto max-w-2xl text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">
            Request a demo
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-white/70">
            Tell us about your facility and what you need to prove at your next
            survey. A real person replies from hello@caremetric.ai.
          </p>
        </div>
      </section>

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <Reveal>
            <h2 className="text-xl font-bold tracking-tight">What to expect</h2>
            <div className="mt-5 grid gap-3">
              {WHAT_TO_EXPECT.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm leading-6 text-foreground/85 shadow-sm"
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Prefer email?{" "}
              <a href={DEMO_MAILTO} className="font-medium text-primary hover:underline">
                hello@caremetric.ai
              </a>{" "}
              reaches the same team. Ready to try it yourself instead?{" "}
              <Link href="/signup" className="font-medium text-primary hover:underline">
                Start a free trial
              </Link>
              .
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            {submitted ? (
              <Card className="border-primary/30 bg-primary/[0.03] shadow-sm" role="status">
                <CardHeader>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                    <MailCheck className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">Request received</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
                  <p>
                    Thanks — we&apos;ll reply to <span className="font-medium text-foreground">{email.trim()}</span>{" "}
                    to set up a time and, if you&apos;d like, a dedicated demo login with sample data.
                  </p>
                  <p className="flex flex-wrap gap-x-4 gap-y-2">
                    <Link
                      href="/#platform"
                      className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                    >
                      Explore the platform meanwhile
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                      href="/faq"
                      className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                    >
                      Read the FAQ
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Tell us about your facility</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="demo-name">Your name</Label>
                        <Input
                          id="demo-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          autoComplete="name"
                          maxLength={200}
                          required
                          data-testid="input-demo-name"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="demo-email">Work email</Label>
                        <Input
                          id="demo-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          autoComplete="email"
                          maxLength={320}
                          required
                          data-testid="input-demo-email"
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="demo-organization">Organization (optional)</Label>
                        <Input
                          id="demo-organization"
                          value={organization}
                          onChange={(e) => setOrganization(e.target.value)}
                          autoComplete="organization"
                          maxLength={200}
                          data-testid="input-demo-organization"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="demo-facilities">Number of facilities (optional)</Label>
                        <Input
                          id="demo-facilities"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={1000}
                          value={facilityCount}
                          onChange={(e) => setFacilityCount(e.target.value)}
                          data-testid="input-demo-facilities"
                        />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="demo-message">What should we focus on? (optional)</Label>
                      <Textarea
                        id="demo-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        maxLength={4000}
                        rows={4}
                        placeholder="e.g. annual training hours across three PCH sites, survey binder prep, replacing spreadsheets"
                        data-testid="input-demo-message"
                      />
                    </div>

                    {turnstileSiteKey ? (
                      <div className="grid gap-1.5">
                        <div ref={turnstileContainerRef} />
                        {turnstileError && (
                          <p className="text-sm text-destructive" role="alert">
                            {turnstileError}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground" role="alert">
                        Demo requests aren&apos;t configured for this deployment. Email{" "}
                        <a href={DEMO_MAILTO} className="font-medium text-primary hover:underline">
                          hello@caremetric.ai
                        </a>{" "}
                        instead.
                      </p>
                    )}

                    <Button
                      type="submit"
                      size="lg"
                      className="gap-2"
                      disabled={isPending || !turnstileSiteKey || (!!turnstileSiteKey && !turnstileToken)}
                      data-testid="button-demo-submit"
                    >
                      <Mail className="h-4 w-4" />
                      {isPending ? "Sending…" : "Send demo request"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </Reveal>
        </div>
      </section>
    </MarketingLayout>
  );
}
