import { useEffect, useRef, useState } from "react";
import { BellRing, CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useSubscribeUpdates } from "@/hooks/useSubscribeUpdates";

/**
 * Same-origin path the visitor came from, so a subscription records which page converted.
 * Cross-origin referrers are dropped.
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

interface NewsletterSignupProps {
  /** Opt-in lists to record for this signup. Defaults to the regulatory-updates list. */
  topics?: string[];
  /** Show optional name/organization fields (fuller lead capture). Defaults to email-only. */
  showNameFields?: boolean;
  className?: string;
}

/**
 * Reusable email-capture form for the "get regulatory updates by email" signup. Owns the same
 * explicit-render Cloudflare Turnstile lifecycle as RequestDemo/Signup (the global
 * `window.turnstile` typing is declared in Signup.tsx) and posts through the subscribe-updates
 * Edge Function. Drop it onto any marketing surface to grow the drip list.
 */
export function NewsletterSignup({ topics, showNameFields = false, className }: NewsletterSignupProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const sourcePathRef = useRef<string | undefined>(undefined);
  const { toast } = useToast();
  const { mutate: subscribe, isPending } = useSubscribeUpdates();
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    sourcePathRef.current = referrerPath() ?? window.location.pathname;
  }, []);

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
    if (!email.trim()) {
      toast({ variant: "destructive", title: "Enter your work email" });
      return;
    }
    if (!turnstileToken) {
      setTurnstileError("Please complete the verification below.");
      return;
    }
    subscribe(
      {
        email: email.trim(),
        name: showNameFields ? name.trim() : undefined,
        organization: showNameFields ? organization.trim() : undefined,
        topics,
        sourcePath: sourcePathRef.current,
        turnstileToken,
      },
      {
        onSuccess: (data) => {
          setAlreadySubscribed(Boolean(data?.alreadySubscribed));
          setSubmitted(true);
        },
        onError: (error) => {
          resetTurnstile();
          toast({
            variant: "destructive",
            title: "Could not complete your subscription",
            description:
              error instanceof Error && error.message
                ? error.message
                : "Something went wrong. Try again in a moment.",
          });
        },
      },
    );
  };

  if (submitted) {
    return (
      <div
        className={`flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-5 text-sm leading-6 text-foreground/85 ${className ?? ""}`}
        role="status"
        data-testid="newsletter-success"
      >
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold text-foreground">
            {alreadySubscribed ? "You're already on the list" : "You're subscribed"}
          </p>
          <p className="mt-1 text-muted-foreground">
            {alreadySubscribed
              ? "This email is already receiving CareBase regulatory updates."
              : "Watch your inbox for a confirmation. We'll email a plain-language note whenever PA regulations change."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`grid gap-3 ${className ?? ""}`} noValidate>
      {showNameFields && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="newsletter-name">Your name (optional)</Label>
            <Input
              id="newsletter-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={200}
              data-testid="input-newsletter-name"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="newsletter-organization">Organization (optional)</Label>
            <Input
              id="newsletter-organization"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              autoComplete="organization"
              maxLength={200}
              data-testid="input-newsletter-organization"
            />
          </div>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="newsletter-email">Work email</Label>
        <Input
          id="newsletter-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          maxLength={320}
          required
          placeholder="you@yourfacility.com"
          data-testid="input-newsletter-email"
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
          Email signup isn&apos;t configured for this deployment. Email{" "}
          <a href="mailto:hello@caremetric.ai" className="font-medium text-primary hover:underline">
            hello@caremetric.ai
          </a>{" "}
          to be added.
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="gap-2"
        disabled={isPending || !turnstileSiteKey || (!!turnstileSiteKey && !turnstileToken)}
        data-testid="button-newsletter-subscribe"
      >
        {isPending ? (
          <>
            <Mail className="h-4 w-4" />
            Subscribing…
          </>
        ) : (
          <>
            <BellRing className="h-4 w-4" />
            Get regulatory updates
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        No spam. Unsubscribe any time. We use your email to send regulatory updates and occasional
        product news.
      </p>
    </form>
  );
}
