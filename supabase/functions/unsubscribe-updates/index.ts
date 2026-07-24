// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

// Public one-click unsubscribe for the marketing/newsletter list. Recipients have no Supabase
// session -- the per-subscriber unsubscribe_token uuid (newsletter_subscribers.unsubscribe_token)
// IS the credential, the same pattern as evidence-guest-download. Supports GET (link click from
// the email footer) and POST (RFC 8058 List-Unsubscribe-Post one-click from the mailbox
// provider), both keyed on the ?token= query parameter.
//
// Idempotent and oracle-free: the same confirmation page is returned whether the token matched a
// subscriber, matched an already-unsubscribed subscriber, or matched nothing at all, so the
// endpoint cannot be used to probe list membership. It only ever narrows access (flips status to
// 'unsubscribed'); no other column is caller-controllable.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_SITE_URL = "https://cmcarebase.com";

function htmlPage(options: { title: string; heading: string; body: string; siteUrl: string }): string {
  const { title, heading, body, siteUrl } = options;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#f4f7fb;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border:1px solid #e5eaf0;border-radius:14px;overflow:hidden;">
    <div style="background:#0d2742;padding:22px 28px;">
      <span style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-0.01em;">CareMetric CareBase</span>
      <div style="color:#9fc4e8;font-size:12px;font-weight:600;margin-top:2px;">Pennsylvania PCH &amp; assisted living compliance</div>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;color:#0d2742;font-size:22px;font-weight:800;line-height:1.25;">${heading}</h1>
      <p style="margin:0 0 18px;color:#2b3a4a;font-size:15px;line-height:1.6;">${body}</p>
      <a href="${siteUrl}" style="display:inline-block;background:#1b6fc2;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:8px;">Back to cmcarebase.com</a>
    </div>
    <div style="padding:16px 28px 24px;border-top:1px solid #e5eaf0;color:#6b7a89;font-size:12px;line-height:1.6;">
      Changed your mind? You can re-subscribe any time at ${siteUrl}/regulatory-updates.
    </div>
  </div>
</body>
</html>`;
}

function htmlResponse(page: string, status = 200): Response {
  return new Response(page, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
}

Deno.serve(async (req: Request) => {
  // OPTIONS for RFC 8058 POST preflights from providers that send one; GET/POST do the work.
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      },
    });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const siteUrl = (Deno.env.get("SITE_URL") || DEFAULT_SITE_URL).replace(/\/$/, "");
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";

  if (!UUID_RE.test(token)) {
    return htmlResponse(
      htmlPage({
        title: "Unsubscribe link invalid",
        heading: "This unsubscribe link isn't valid",
        body:
          "The link is incomplete or has been altered. Open the unsubscribe link from the bottom of the email again, or email hello@caremetric.ai and we'll remove you by hand.",
        siteUrl,
      }),
      400,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("unsubscribe-updates is missing required Supabase environment variables");
    return htmlResponse(
      htmlPage({
        title: "Unsubscribe unavailable",
        heading: "We couldn't process that right now",
        body: "Please try again in a few minutes, or email hello@caremetric.ai and we'll remove you by hand.",
        siteUrl,
      }),
      500,
    );
  }

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient
    .from("newsletter_subscribers")
    .update({ status: "unsubscribed" })
    .eq("unsubscribe_token", token);
  if (error) {
    console.error("unsubscribe-updates update failed", error.message);
    return htmlResponse(
      htmlPage({
        title: "Unsubscribe unavailable",
        heading: "We couldn't process that right now",
        body: "Please try again in a few minutes, or email hello@caremetric.ai and we'll remove you by hand.",
        siteUrl,
      }),
      500,
    );
  }

  // Same page whether the token matched or not -- see the oracle note in the header comment.
  return htmlResponse(
    htmlPage({
      title: "You're unsubscribed",
      heading: "You're unsubscribed",
      body:
        "You won't receive any more regulatory-update emails from CareMetric CareBase at this address. The live feed stays free to read on the site any time.",
      siteUrl,
    }),
  );
});
