import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { absoluteAppUrl } from "@/lib/appUrl";

export const INVITE_RESEND_ACK = "If you were invited, a new link is on its way.";

/**
 * Asks for a fresh invitation without saying whether the address was invited.
 * The edge function returns the same acknowledgement for every outcome; this
 * form shows that sentence even when the request itself fails.
 */
export function InviteLinkResend({ email, idPrefix = "invite-resend" }: { email?: string; idPrefix?: string }) {
  const [address, setAddress] = useState(email ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = address.trim();
    if (sending || sent || !trimmed) return;
    setSending(true);
    try {
      await supabase.functions.invoke("resend-invite-link", {
        body: { email: trimmed, redirect_to: absoluteAppUrl("/reset-password") },
      });
    } catch {
      // The acknowledgement does not depend on whether this address was invited.
    } finally {
      setSending(false);
      setSent(true);
    }
  };

  if (sent) {
    return <p className="text-sm text-muted-foreground">{INVITE_RESEND_ACK}</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      {email ? null : (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-email`} className="text-[13px] font-medium">Email address</Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            autoComplete="email"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            disabled={sending}
            className="h-10"
            required
          />
        </div>
      )}
      <Button type="submit" className="w-full h-10" disabled={sending}>
        {sending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending...
          </>
        ) : (
          "Send me a new link"
        )}
      </Button>
    </form>
  );
}
