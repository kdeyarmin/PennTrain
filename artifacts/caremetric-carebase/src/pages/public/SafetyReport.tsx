import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ShieldCheck } from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";

type SubmissionResult = {
  intakeNumber?: unknown;
  confirmationToken?: unknown;
  resumeSecret?: unknown;
};

type ResolvedFacility = {
  facilityId: string;
  facilityName: string;
  token: string;
};

function tokenFromLocation(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return (params.get("facility_token") ?? params.get("facility") ?? params.get("facility_id") ?? "").trim();
  } catch {
    return "";
  }
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

/**
 * Is this a COMPLETE facility code, worth spending a lookup on?
 *
 * `resolve_safety_report_facility` runs `public.guest_request_denial('safety_report', ...)` before
 * anything else, and every token that resolves to nothing is one of ten "unknown token" strikes a
 * minute for the caller's whole address (20260905230000 / 20260905360000). The poster token is
 * `replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')` -- exactly 64 hex
 * characters (20260731120000:62) -- and the legacy QR form is a facility UUID. A debounced lookup
 * on every keystroke therefore burned a strike on each of the value's incomplete prefixes: after
 * the tenth pause a reporter typing their own valid code by hand was throttled out of the page and
 * logged in `guest_token_failures` as a scanner. Nothing shorter can ever match, so nothing
 * shorter is sent.
 */
function isCompleteFacilityCode(value: string): boolean {
  const trimmed = value.trim();
  return /^[0-9a-f]{64}$/i.test(trimmed) || looksLikeUuid(trimmed);
}

/**
 * The submit-confidential-intake function puts its real reason in the JSON body of a non-2xx
 * response ("Too many reports have been submitted from this network..."), which supabase-js hands
 * back as a bare FunctionsHttpError whose message is "Edge Function returned a non-2xx status
 * code". A confidential reporter met that string and had no idea they had been rate-limited by
 * their colleagues, let alone what to do next. Same unwrapping as useRequestDemo.
 */
async function intakeErrorMessage(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    const body = (await error.context.json()) as { message?: unknown; error?: unknown } | null;
    if (typeof body?.message === "string" && body.message.trim()) return body.message;
    if (typeof body?.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Response body wasn't JSON -- fall back to the generic message.
  }
  return null;
}

export default function SafetyReport() {
  usePageMeta({ ...MARKETING_ROUTE_META["/report-safety"], path: "/report-safety" });
  const { toast } = useToast();
  const prefilledToken = useMemo(() => tokenFromLocation(), []);
  const [facilityToken, setFacilityToken] = useState(prefilledToken);
  const [resolved, setResolved] = useState<ResolvedFacility | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
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
  const canSubmit = Boolean(resolved?.facilityId);

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

    // The widget's own error-callback only fires once the API is running, so a script that never
    // loads at all (egress filtering, outage, blocked domain) would otherwise leave the reporter
    // with an empty token, a permanently disabled submit button, and no explanation.
    const onScriptError = () => {
      if (canceled) return;
      setToken("");
      setTurnstileError("Verification could not load. Check your connection, refresh the page, or contact support.");
    };

    let script: HTMLScriptElement | null = null;
    if (window.turnstile) {
      render();
    } else {
      script = document.getElementById("cloudflare-turnstile-api") as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.id = "cloudflare-turnstile-api";
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
      script.addEventListener("error", onScriptError);
    }

    return () => {
      canceled = true;
      if (script) {
        script.removeEventListener("load", render);
        script.removeEventListener("error", onScriptError);
      }
    };
  }, [siteKey]);

  useEffect(() => {
    const value = facilityToken.trim();
    // Only a complete code is looked up: see isCompleteFacilityCode -- every partial value was an
    // unknown-token strike against the reporter's whole building.
    if (!isCompleteFacilityCode(value)) {
      setResolved(null);
      setResolveError(null);
      // A resolve already in flight has its cleanup set canceled, so its `finally` will not
      // clear this. Without the reset here the form stays stuck on "Checking facility code…"
      // as soon as the reporter deletes a character.
      setResolving(false);
      return;
    }
    let canceled = false;
    setResolving(true);
    setResolveError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { data, error } = await (supabase as any).rpc("resolve_safety_report_facility", { p_token: value });
          if (canceled) return;
          if (error) throw error;
          if (!data || !data.facilityId) {
            setResolved(null);
            setResolveError("That facility code is not recognized. Scan the poster QR code or ask your employer for a valid link.");
            return;
          }
          setResolved({
            facilityId: String(data.facilityId),
            facilityName: String(data.facilityName ?? "Facility"),
            token: String(data.token ?? value),
          });
          setResolveError(null);
        } catch (err) {
          if (canceled) return;
          setResolved(null);
          setResolveError(err instanceof Error ? err.message : "Could not verify this facility code.");
        } finally {
          if (!canceled) setResolving(false);
        }
      })();
    }, 300);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [facilityToken]);

  const copyValue = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ variant: "destructive", title: `Could not copy ${label.toLowerCase()}` });
    }
  };

  const submit = async () => {
    if (!resolved?.facilityId) {
      toast({
        variant: "destructive",
        title: "Facility required",
        description: "Scan the facility poster QR code or enter the code provided by your employer.",
      });
      return;
    }
    setPending(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-confidential-intake", {
        body: {
          turnstile_token: token,
          facility_id: resolved.facilityId,
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
        throw new Error(typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : "The report could not be accepted. Check the facility code and try again.");
      }
      setResult(payload);
    } catch (err) {
      setToken("");
      setTurnstileError(null);
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
      // The function's own wording first; "Edge Function returned a non-2xx status code" is not a
      // thing to show a person who has just tried to report a safety incident.
      const message = (await intakeErrorMessage(err)) ?? (err instanceof Error ? err.message : "Please try again.");
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
<Button
  type="button"
  size="sm"
  variant="outline"
  aria-label="Copy confirmation number"
  onClick={() => void copyValue("Confirmation number", String(result.intakeNumber))}
>
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
                <Label htmlFor="facility">Facility</Label>
                {resolved ? (
                  <div className="rounded-lg border bg-muted/40 px-3 py-2">
                    <p className="text-sm font-medium">{resolved.facilityName}</p>
                    <p className="text-xs text-muted-foreground">
                      {prefilledToken ? "Matched from the poster QR / link you opened." : "Facility verified."}
                      {looksLikeUuid(facilityToken) ? " (legacy facility link)" : ""}
                    </p>
                    {!prefilledToken && (
                      <Button type="button" variant="link" className="h-auto px-0 text-xs" onClick={() => { setFacilityToken(""); setResolved(null); }}>
                        Use a different facility code
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    <Input
                      id="facility"
                      value={facilityToken}
                      onChange={(e) => setFacilityToken(e.target.value)}
                      placeholder="Paste facility code from the posted QR"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="text-xs text-muted-foreground">
                      Use the QR code or link posted at your facility. Do not guess this value — reports without a valid facility code cannot be routed.
                    </p>
                    {facilityToken.trim().length > 0 && !isCompleteFacilityCode(facilityToken) && (
                      <p className="text-xs text-muted-foreground">
                        Enter the whole code (64 characters from the poster, or a facility link). It is
                        checked once it is complete.
                      </p>
                    )}
                  </>
                )}
                {resolving && <p className="text-xs text-muted-foreground">Checking facility code…</p>}
                {resolveError && (
                  <p role="alert" className="text-xs text-destructive">{resolveError}</p>
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
                disabled={!siteKey || !token || !canSubmit || summary.trim().length < 5 || narrative.trim().length < 10 || pending}
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
