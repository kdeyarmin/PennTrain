import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
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

export default function SafetyReport() {
  const { toast } = useToast();
  const [facility, setFacility] = useState("");
  const [summary, setSummary] = useState("");
  const [narrative, setNarrative] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    if (!siteKey) return;

    let canceled = false;
    const render = () => {
      if (!canceled && window.turnstile && container.current && !widget.current) {
        widget.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          callback: setToken,
          "expired-callback": () => setToken(""),
          "error-callback": () => setToken(""),
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
      return () => {
        canceled = true;
        script?.removeEventListener("load", render);
      };
    }

    return () => {
      canceled = true;
    };
  }, [siteKey]);

  const submit = async () => {
    setPending(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-confidential-intake", {
        body: {
          turnstile_token: token,
          facility_id: facility,
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
      setResult((data?.data ?? null) as SubmissionResult | null);
    } catch (error) {
      setToken("");
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
      toast({
        variant: "destructive",
        title: "Report could not be submitted",
        description: error instanceof Error ? error.message : "Please try again.",
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
            <div className="rounded-lg border bg-muted p-4">
              <p className="font-medium">Report received</p>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="font-medium">Confirmation number</dt>
                  <dd>{String(result.intakeNumber ?? "")}</dd>
                </div>
                <div>
                  <dt className="font-medium">Confirmation token</dt>
                  <dd className="break-all font-mono text-xs">{String(result.confirmationToken ?? "")}</dd>
                </div>
                <div>
                  <dt className="font-medium">Resume secret</dt>
                  <dd className="break-all font-mono text-xs">{String(result.resumeSecret ?? "")}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">Store the confirmation token and resume secret securely. They are shown only once.</p>
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="facility">Facility ID</Label>
                <Input id="facility" value={facility} onChange={(e) => setFacility(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="summary">Short summary</Label>
                <Input id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="narrative">What happened?</Label>
                <Textarea id="narrative" value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={6} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="danger">Immediate danger</Label>
                <Switch id="danger" checked={urgent} onCheckedChange={setUrgent} />
              </div>
              <div ref={container} />
              {!siteKey && (
                <p role="alert" className="text-sm text-destructive">
                  Safety report verification is not configured. Please contact support.
                </p>
              )}
              <Button
                className="w-full"
                onClick={() => void submit()}
                disabled={!siteKey || !token || !facility || summary.trim().length < 5 || narrative.trim().length < 10 || pending}
              >
                Submit confidential report
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
