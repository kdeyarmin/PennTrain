import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useSignupOrganization } from "@/hooks/useSignup";
import { Loader2, ArrowRight, CheckCircle2 } from "lucide-react";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";
import { BAA_VERSION, SERVICE_AGREEMENT_VERSION } from "@/lib/legalAgreements";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

interface SignupForm {
  organizationName: string;
  firstName: string;
  lastName: string;
  email: string;
}

const EMPTY_FORM: SignupForm = {
  organizationName: "", firstName: "", lastName: "", email: "",
};

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove?: (widgetId: string) => void;
    };
  }
}

export default function Signup() {
  usePageMeta({ ...MARKETING_ROUTE_META["/signup"], path: "/signup" });
  const [form, setForm] = useState<SignupForm>(EMPTY_FORM);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { mutate: signup, isPending } = useSignupOrganization();
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  const field = (k: keyof SignupForm, v: string) => setForm(f => ({ ...f, [k]: v }));

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
          setTurnstileError("Verification could not load for this domain. Refresh the page or contact support.");
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
      const handleScriptError = () => setTurnstileError("Verification could not load. Check your connection and refresh the page.");
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
    setTurnstileError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.organizationName.trim() || !form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      toast({ variant: "destructive", title: "All fields are required" });
      return;
    }
    if (!legalAccepted) {
      toast({ variant: "destructive", title: "Legal agreement acceptance required", description: "An authorized facility administrator must accept the platform agreement and BAA before signup." });
      return;
    }
    if (!turnstileSiteKey || !turnstileToken) {
      toast({ variant: "destructive", title: "Signup verification required" });
      return;
    }

    const email = form.email.trim();
    signup(
      {
        email,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        organizationName: form.organizationName.trim(),
        legalAccepted,
        turnstileToken,
        redirectTo: `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/reset-password`,
        serviceAgreementVersion: SERVICE_AGREEMENT_VERSION,
        baaVersion: BAA_VERSION,
      },
      {
        onSuccess: () => {
          setSubmittedEmail(email);
          toast({ title: "Check your email", description: "Use the invite link to set your password." });
        },
        onError: (err: Error) => {
          resetTurnstile();
          toast({ variant: "destructive", title: "Couldn't create your account", description: err.message });
        },
      },
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden py-12">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500/[0.03] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

      <div className="w-full max-w-[460px] space-y-8 relative z-10 px-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <Link href="/" aria-label="CareMetric CareBase home">
            <LogoMark className="h-20 w-20" />
          </Link>
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-bold tracking-tight" style={{ color: BRAND_BLUE }}>
              <BrandName />
            </h1>
            <p className="text-sm text-muted-foreground">Operations &amp; Compliance Platform</p>
          </div>
        </div>

        <Card className="border-border/50 shadow-xl shadow-black/[0.04] backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">{submittedEmail ? "Check your email" : "Create your organization"}</CardTitle>
            <CardDescription>
              {submittedEmail
                ? `We sent an invite link to ${submittedEmail}.`
                : "Set up your facility's account to start tracking training and compliance."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submittedEmail ? (
              <div className="space-y-4 text-center">
                <div className="mx-auto h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Open the link from your email to verify the address and choose a password.
                </p>
                <Button type="button" className="w-full h-10" onClick={() => setLocation("/login")}>
                  Back to sign in
                </Button>
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="organizationName" className="text-[13px] font-medium">Organization / Facility Name</Label>
                <Input
                  id="organizationName"
                  value={form.organizationName}
                  onChange={e => field("organizationName", e.target.value)}
                  placeholder="Sunrise Healthcare"
                  disabled={isPending}
                  className="h-10"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-[13px] font-medium">First Name</Label>
                  <Input
                    id="firstName"
                    value={form.firstName}
                    onChange={e => field("firstName", e.target.value)}
                    disabled={isPending}
                    className="h-10"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-[13px] font-medium">Last Name</Label>
                  <Input
                    id="lastName"
                    value={form.lastName}
                    onChange={e => field("lastName", e.target.value)}
                    disabled={isPending}
                    className="h-10"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[13px] font-medium">Work Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={e => field("email", e.target.value)}
                  placeholder="you@example.com"
                  disabled={isPending}
                  className="h-10"
                  required
                />
              </div>
              <label htmlFor="legalAccepted" className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3 text-sm leading-5">
                <Checkbox
                  id="legalAccepted"
                  checked={legalAccepted}
                  onCheckedChange={checked => setLegalAccepted(checked === true)}
                  disabled={isPending}
                  className="mt-0.5"
                />
                <span>
                  I am authorized to bind this facility or organization, and I agree to the{" "}
                  <Link href="/legal/facility-signup" className="font-medium text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                    Facility Administrator Platform Agreement and HIPAA Business Associate Agreement
                  </Link>{" "}
                  ({SERVICE_AGREEMENT_VERSION}; {BAA_VERSION}) for CareMetric AI LLC.
                </span>
              </label>
              {turnstileSiteKey ? (
                <div className="min-h-[65px]">
                  <div ref={turnstileContainerRef} />
                  {turnstileError && (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      {turnstileError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  Signup verification is not configured for this deployment.
                </div>
              )}
              <Button type="submit" className="w-full h-10 font-medium shadow-sm" disabled={isPending || !legalAccepted || !turnstileSiteKey || !turnstileToken}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating your account...
                  </>
                ) : (
                  <>
                    Send verification email
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
            )}
            {!submittedEmail && (
              <div>
                <p className="mt-4 text-center text-[13px] text-muted-foreground">
                  Creating your organization starts a 14-day free trial.
                </p>
                <p className="mt-2 text-center text-[13px] text-muted-foreground">
                  Already have an account?{" "}
                  <Link href="/login" className="font-medium text-primary hover:text-primary/80">
                    Sign in
                  </Link>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60">
          55 Pa. Code Chapters 2600 &amp; 2800 Compliance Platform
        </p>
      </div>
    </div>
  );
}
