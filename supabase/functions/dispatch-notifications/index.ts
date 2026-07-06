import { createClient } from "jsr:@supabase/supabase-js@2";

// Internal cron-only endpoint: invoked exclusively by the dispatch-notification-deliveries
// pg_cron job every 15 minutes via net.http_post (see
// supabase/migrations/20260705061816_notification_delivery_engine.sql). Deliberately
// verify_jwt:false (see supabase/config.toml) -- pg_net has no way to obtain a user JWT, and this
// function takes no caller-supplied parameters that could expose one org's data to another; it
// always processes the same system-wide pending queue regardless of who/what calls it, the same
// way a public health-check endpoint would. All actual data access goes through this function's
// own service-role client, which every other privileged Edge Function in this repo already uses
// the same way.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const BATCH_SIZE = 200;
const NOT_CONFIGURED_EMAIL = "SENDGRID_API_KEY is not set -- email delivery is not configured for this deployment.";
const NOT_CONFIGURED_SMS = "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER are not fully set -- SMS delivery is not configured for this deployment.";

interface PendingDelivery {
  id: string;
  channel: "email" | "sms";
  recipient: string;
  notification_id: string | null;
  notifications: { title: string; body: string | null } | null;
}

// Accepts either a plain address or a "Display Name <email>" string (the format Resend used to
// take directly) and splits it into the {email, name} shape SendGrid's v3 API requires.
function parseFromAddress(raw: string): { email: string; name?: string } {
  const match = raw.match(/^(.*)<([^<>]+)>\s*$/);
  if (!match) return { email: raw.trim() };
  const name = match[1].trim().replace(/^"|"$/g, "");
  return { email: match[2].trim(), name: name || undefined };
}

async function sendEmail(to: string, subject: string, body: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) return { ok: false, error: NOT_CONFIGURED_EMAIL };
  const from = parseFromAddress(
    Deno.env.get("NOTIFICATION_FROM_EMAIL") || "CareMetric Train <notifications@caremetrictrain.com>",
  );
  try {
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from,
        subject,
        content: [{ type: "text/plain", value: body }],
      }),
    });
    // SendGrid returns 202 with an empty body on success and an X-Message-Id header;
    // errors come back as { errors: [{ message, field, help }] }.
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const message = Array.isArray(data?.errors) && typeof data.errors[0]?.message === "string"
        ? data.errors[0].message
        : `SendGrid API returned ${resp.status}`;
      return { ok: false, error: message };
    }
    return { ok: true, providerId: resp.headers.get("x-message-id") ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendSms(to: string, body: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !authToken || !fromNumber) return { ok: false, error: NOT_CONFIGURED_SMS };
  try {
    const form = new URLSearchParams({ To: to, From: fromNumber, Body: body.slice(0, 1500) });
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: typeof data?.message === "string" ? data.message : `Twilio API returned ${resp.status}` };
    return { ok: true, providerId: data?.sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Atomically claim a batch by flipping status pending -> processing in a single UPDATE, so an
  // overlapping cron-fired invocation's claim never matches rows this invocation already grabbed
  // (same status='pending' compare-and-swap shape as attest-policy's update).
  const { data: pending, error: claimError } = await adminClient
    .from("notification_deliveries")
    .update({ status: "processing" })
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(BATCH_SIZE)
    .select("id, channel, recipient, notification_id, notifications(title, body)");

  if (claimError) return json({ error: claimError.message }, 500);
  if (!pending || pending.length === 0) return json({ processed: 0, sent: 0, skipped: 0, failed: 0 });

  let sent = 0, skipped = 0, failed = 0;

  for (const rawRow of pending) {
    const row = rawRow as unknown as PendingDelivery;
    const title = row.notifications?.title ?? "CareMetric Train notification";
    const body = row.notifications?.body ?? "";
    const message = row.channel === "sms" ? `${title}: ${body}` : body || title;

    const result = row.channel === "email"
      ? await sendEmail(row.recipient, title, message)
      : await sendSms(row.recipient, message);

    const isNotConfigured = result.error === NOT_CONFIGURED_EMAIL || result.error === NOT_CONFIGURED_SMS;
    const nextStatus = result.ok ? "sent" : isNotConfigured ? "skipped" : "failed";
    if (nextStatus === "sent") sent++;
    else if (nextStatus === "skipped") skipped++;
    else failed++;

    await adminClient
      .from("notification_deliveries")
      .update({
        status: nextStatus,
        provider_message_id: result.providerId ?? null,
        error_message: result.error ?? null,
        sent_at: result.ok ? new Date().toISOString() : null,
      })
      .eq("id", row.id);
  }

  return json({ processed: pending.length, sent, skipped, failed });
});
