import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type SubmissionResult = {
  intakeNumber?: unknown;
  confirmationToken?: unknown;
  resumeSecret?: unknown;
};

function facilityIdFromLocation(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return (params.get("facility") ?? params.get("facility_id") ?? "").trim();
  } catch {
    return "";
  }
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export default function SafetyReport() {
  const { toast } = useToast();
  const prefilledFacility = useMemo(() => facilityIdFromLocation(), []);
  const [facility, setFacility] = useState(prefilledFacility);
  const [summary, setSummary] = useState("");
  const [narrative, setNarrative] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [token, setToken] = useState("");
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const facilityLooksValid = looksLikeUuid(facility);

  useEffect(() => {
    if (!siteKey) return;

    let canceled = false;
    const render = () => {
      if (!canceled && window.turnstile && container.current && !widget.current) {
        widget.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          callback: (nextToken) => {
            setToken(nextToken);
            setTurnstileError(null);
          },
          "expired-callback": () => {
            setToken("");
            setTurnstileError("Verification expired. Please complete it again.");
          },
          "error-callback": () => {
            setToken("");
            setTurnstileError("Verification could not load for this domain. Refresh the page or contact support.");
          },
        });
      }
    };

    if (window.turnstile) {
      render();
    } else {
      let script = document.getElementById("cloudflare-turnstile-api") as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.id = "cloudflare-turnstile-api";
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
      const handleScriptError = () => setTurnstileError("Verification could not load. Check your connection and refresh the page.");
      script.addEventListener("error", handleScriptError);
      return () => {
        canceled = true;
        script?.removeEventListener("load", render);
        script?.removeEventListener("error", handleScriptError);
      };
    }

    return () => {
      canceled = true;
    };
  }, [siteKey]);

  const copyValue = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ variant: "destructive", title: `Could not copy ${label.toLowerCase()}` });
    }
  };

  const submit = async () => {
    if (!facilityLooksValid) {
      toast({
        variant: "destructive",
        title: "Facility code required",
        description: "Scan the facility poster QR code or enter the facility ID provided by your employer.",
      });
      return;
    }
    setPending(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-confidential-intake", {
        body: {
          turnstile_token: token,
          facility_id: facility.trim(),
          report_type: "safety_concern",
          occurred_at: new Date().toISOString(),
          immediate_danger: urgent,
          severity: urgent ? "critical" : "moderate",
          reporter_mode: "anonymous",
          public_summary: summary,
          narrative,
        },
      });
      if (error) throw error;
      const payload = (data?.data ?? data ?? null) as SubmissionResult | null;
      if (!payload || (!payload.intakeNumber && !payload.confirmationToken)) {
        throw new Error(typeof data?.error === "string" ? data.error : "The report could not be accepted. Check the facility code and try again.");
      }
      setResult(payload);
    } catch (err) {
      setToken("");
      setTurnstileError(null);
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({
        variant: "destructive",
        title: "Submission failed",
        description: message,
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl p-4 py-10">
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            Confidential safety intake
          </div>
          <CardTitle>Report an incident or near miss</CardTitle>
          <CardDescription>Reporter identity is separated from investigation details. Immediate danger routes urgently.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {result ? (
            <div className="rounded-lg border bg-muted p-4 space-y-3">
              <p className="font-medium">Report received</p>
              <p className="text-sm text-muted-foreground">
                Save these values now. They are shown only once and are required if you need to follow up later.
              </p>
              <dl className="space-y-3 text-sm">
                <div className="space-y-1">
                  <dt className="font-medium">Confirmation number</dt>
                  <dd className="flex items-start justify-between gap-2">
                    <span className="break-all">{String(result.intakeNumber ?? "")}</span>
                    {result.intakeNumber != null && (
                      <Button type="button" size="sm" variant="outline" onClick={() => void copyValue("Confirmation number", String(result.intakeNumber))}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="font-medium">Confirmation token</dt>
                  <dd className="flex items-start justify-between gap-2">
                    <span className="break-all font-mono text-xs">{String(result.confirmationToken ?? "")}</span>
                    {result.confirmationToken != null && (
                      <Button type="button" size="sm" variant="outline" onClick={() => void copyValue("Confirmation token", String(result.confirmationToken))}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="font-medium">Resume secret</dt>
                  <dd className="flex items-start justify-between gap-2">
                    <span className="break-all font-mono text-xs">{String(result.resumeSecret ?? "")}</span>
                    {result.resumeSecret != null && (
                      <Button type="button" size="sm" variant="outline" onClick={() => void copyValue("Resume secret", String(result.resumeSecret))}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Print or photograph this screen if you cannot store the values digitally. Do not share the resume secret with anyone who should not access this report.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="facility">Facility code</Label>
                <Input
                  id="facility"
                  value={facility}
                  onChange={(e) => setFacility(e.target.value)}
                  placeholder="Paste facility ID from the posted QR code"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {prefilledFacility
                    ? "Facility code was filled from the link or QR code you opened. Change it only if this is the wrong location."
                    : "Use the QR code or link posted at your facility. Do not guess this value — reports without a valid facility code cannot be routed."}
                </p>
                {facility.trim() && !facilityLooksValid && (
                  <p role="alert" className="text-xs text-destructive">
                    Enter the full facility ID from the poster (it looks like a long code with hyphens).
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="summary">Short summary</Label>
                <Input id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened, in one sentence" />
              </div>
              <div>
                <Label htmlFor="narrative">What happened?</Label>
                <Textarea id="narrative" value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={6} placeholder="Include when, where, who was involved (initials only when needed), and any immediate action taken." />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="danger">Immediate danger</Label>
                <Switch id="danger" checked={urgent} onCheckedChange={setUrgent} />
              </div>
              <div ref={container} />
              {turnstileError && (
                <p role="alert" className="text-sm text-destructive">
                  {turnstileError}
                </p>
              )}
              {!siteKey && (
                <p role="alert" className="text-sm text-destructive">
                  Verification is unavailable. Contact support.
                </p>
              )}
              <Button
                className="w-full"
                onClick={() => void submit()}
                disabled={!siteKey || !token || !facilityLooksValid || summary.trim().length < 5 || narrative.trim().length < 10 || pending}
              >
                {pending ? "Submitting…" : "Submit confidential report"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
