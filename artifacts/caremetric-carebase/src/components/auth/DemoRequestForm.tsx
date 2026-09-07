import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useRequestDemo } from "@/hooks/useRequestDemo";

/**
 * Request form shown on /demo when the deployment has no public demo accounts configured, so the
 * page offers a way through instead of a dead end. Owns the same explicit-render Cloudflare
 * Turnstile lifecycle as Signup/NewsletterSignup (the global `window.turnstile` typing is declared
 * in Signup.tsx) and posts through the request-demo Edge Function, which requires the token.
 *
 * Mounted only in the no-accounts branch: keeping the lifecycle in this component means the
 * Turnstile script is never injected on the demo host, where the account picker renders instead.
 */
export function DemoRequestForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const { toast } = useToast();
  const { mutate: requestDemo, isPending } = useRequestDemo();
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

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
      toast({ variant: "destructive", title: "Your name and work email are required" });
      return;
    }
    if (!turnstileToken) {
      setTurnstileError("Please complete the verification below.");
      return;
    }
    requestDemo(
      {
        name: name.trim(),
        email: email.trim(),
        organization: organization.trim(),
        message: message.trim(),
        sourcePath: window.location.pathname,
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
                : "Something went wrong. Try again in a moment.",
          });
        },
      },
    );
  };

  if (submitted) {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/[0.04] p-4 text-sm leading-6"
        role="status"
        data-testid="demo-request-success"
      >
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold text-foreground">Request received</p>
          <p className="mt-1 text-muted-foreground">
            The CareMetric team will set up a safe workspace and email {email.trim()} with the details.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-lg border bg-muted/30 p-4" noValidate>
      <p className="text-sm text-muted-foreground">
        Public demo accounts are not configured for this deployment. Tell us where to reach you and
        the CareMetric team will set up a safe workspace for you.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="demo-request-name" className="text-[13px] font-medium">Your name</Label>
          <Input
            id="demo-request-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={200}
            disabled={isPending}
            required
            data-testid="input-demo-request-name"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="demo-request-email" className="text-[13px] font-medium">Work email</Label>
          <Input
            id="demo-request-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            maxLength={320}
            placeholder="you@yourfacility.com"
            disabled={isPending}
            required
            data-testid="input-demo-request-email"
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="demo-request-organization" className="text-[13px] font-medium">Facility name</Label>
        <Input
          id="demo-request-organization"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          autoComplete="organization"
          maxLength={200}
          placeholder="Sunrise Healthcare"
          disabled={isPending}
          data-testid="input-demo-request-organization"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="demo-request-message" className="text-[13px] font-medium">
          Anything you want to see (optional)
        </Label>
        <Textarea
          id="demo-request-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          rows={3}
          disabled={isPending}
          data-testid="input-demo-request-message"
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
          <a href="mailto:hello@caremetric.ai" className="font-medium text-primary hover:underline">
            hello@caremetric.ai
          </a>{" "}
          and we&apos;ll set one up.
        </p>
      )}

      <Button
        type="submit"
        className="gap-2"
        disabled={isPending || !turnstileSiteKey || !turnstileToken}
        data-testid="button-demo-request-submit"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Request a demo account
          </>
        )}
      </Button>
    </form>
  );
}
