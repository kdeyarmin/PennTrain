import { useEffect, useRef, useState } from "react";
import { recoverBillingCheckout, type BillingCheckoutRecovery } from "@/hooks/useEnterpriseFoundation";
import { billingSessionFailureCopy } from "@/lib/billingErrors";
import { Button } from "@/components/ui/button";

type Observation = Omit<BillingCheckoutRecovery, "result"> & {
  result: Omit<NonNullable<BillingCheckoutRecovery["result"]>, "session"> | null;
};

/** Parent keys this panel by current actor and organization. Provider links are
 * used only from the fresh, explicit Open request and never retained in state. */
export function BillingCheckoutRecovery({organizationId}: {organizationId: string}) {
  const [observation, setObservation] = useState<Observation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(true), pending = useRef(false), requestId = useRef<string | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function inspect(open: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const value = await recoverBillingCheckout(organizationId, requestId.current);
      if (!active.current) return;
      const session = value.result?.session;
      if (open && value.result?.outcome === "open" && session) {
        const prefix = `https://checkout.stripe.com/c/pay/${session.id}`;
        const suffix = session.url.startsWith(prefix) ? session.url.slice(prefix.length) : null;
        if (!/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(session.id) || session.id.startsWith("cs_live_") !== session.livemode
          || session.url.length > 4096 || suffix === null || !(suffix === "" || /^#[A-Za-z0-9%._~!$&()*+,;=:/?@-]+$/.test(suffix))
          || /%(?![0-9a-f]{2})/i.test(session.url) || !(Date.parse(session.expiresAt) > Date.now())) throw new Error("Checkout link unavailable");
        window.location.assign(session.url);
      }
      const result = value.result ? {commandId: value.result.commandId, action: value.result.action, targetId: value.result.targetId,
        outcome: value.result.outcome, availability: value.result.availability, checkedAt: value.result.checkedAt,
        canStartNewCheckout: value.result.canStartNewCheckout} : null;
      setObservation({...value, result});
      // A terminal/no-reservation check is complete; the next inspection must
      // discover any later reservation rather than reusing the old observation.
      if (!result || value.canStartNewCheckout) requestId.current = null;
    } catch (failure) {
      if (active.current) setError(billingSessionFailureCopy(failure, "Checkout could not be checked").description);
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return <div className="space-y-2 rounded-lg border p-4">
    <p className="font-medium">Existing Checkout</p>
    <p className="text-sm text-muted-foreground">Check an earlier Checkout after signing in again. This preserves its original terms and does not create a session.</p>
    <div className="flex gap-2">
      <Button variant="outline" disabled={busy} onClick={() => void inspect(false)}>{busy ? "Checking…" : "Check existing Checkout"}</Button>
      {observation?.result?.outcome === "open" && <Button disabled={busy} onClick={() => void inspect(true)}>Check and open existing Checkout</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {observation && <div role="status" className="space-y-1 text-sm">
      <p>{observation.result ? `Provider observation: ${observation.result.outcome}${observation.result.availability === "unavailable" ? " (provider unavailable)" : ""}.` : "No unresolved Checkout reservation was found."}</p>
      {observation.preview && <p>Original terms: every {observation.preview.summary.intervalCount} {observation.preview.summary.billingInterval}(s), quantity {observation.preview.summary.quantity}, trial {observation.preview.summary.trialDays} days.</p>}
      <p>{observation.canStartNewCheckout ? "A new Checkout can be reviewed using the current plan catalog." : "A new Checkout is not currently available. Existing subscription or unresolved provider state still applies."}</p>
    </div>}
  </div>;
}
