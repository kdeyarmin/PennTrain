// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

// Public one-click unsubscribe for the marketing/newsletter list. Recipients have no Supabase
// session -- the per-subscriber unsubscribe_token uuid (newsletter_subscribers.unsubscribe_token)
// IS the credential, the same pattern as evidence-guest-download. Both GET (link click from the
// email footer) and POST (RFC 8058 List-Unsubscribe-Post one-click from the mailbox provider) are
// keyed on the ?token= query parameter, but only POST changes anything.
//
// GET is deliberately a read-only confirmation page with a POST button, not the unsubscribe
// itself. A mail-security link scanner (Outlook SafeLinks and similar) fetches every URL in a
// message before the recipient ever sees it, so a GET that wrote would silently unsubscribe the
// recipient of the welcome email. RFC 8058 one-click is POST-only for exactly this reason, and
// scanners do not POST.
//
// Idempotent and oracle-free: the same confirmation page is returned whether the token matched a
// subscriber, matched an already-unsubscribed subscriber, or matched nothing at all, so the
// endpoint cannot be used to probe list membership. It only ever narrows access (flips status to
// 'unsubscribed'); no other column is caller-controllable.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_SITE_URL = "https://cmcarebase.com";
const CORS_OPTIONS = {
  headers: "content-type",
  methods: "GET, POST, OPTIONS",
};

function htmlPage(
  options: { title: string; heading: string; body: string; siteUrl: string; confirmAction?: string },
): string {
  const { title, heading, body, siteUrl, confirmAction } = options;
  // `confirmAction` is only ever built from a token that already matched UUID_RE, so nothing
  // caller-controlled reaches this attribute.
  const actions = confirmAction
    ? `<form method="post" action="${confirmAction}" style="margin:0;">
        <button type="submit" style="display:inline-block;background:#1b6fc2;color:#ffffff;border:0;cursor:pointer;font-weight:700;font-size:14px;font-family:inherit;padding:11px 20px;border-radius:8px;">Unsubscribe me</button>
        <a href="${siteUrl}" style="display:inline-block;color:#1b6fc2;text-decoration:none;font-weight:700;font-size:14px;padding:11px 12px;">Keep me subscribed</a>
      </form>`
    : `<a href="${siteUrl}" style="display:inline-block;background:#1b6fc2;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:8px;">Back to cmcarebase.com</a>`;
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
      ${actions}
    </div>
    <div style="padding:16px 28px 24px;border-top:1px solid #e5eaf0;color:#6b7a89;font-size:12px;line-height:1.6;">
      Changed your mind? You can re-subscribe any time at ${siteUrl}/regulatory-updates.
    </div>
  </div>
</body>
</html>`;
}

function htmlResponse(req: Request, page: string, status = 200): Response {
  return new Response(page, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      ...corsHeadersForRequest(req, CORS_OPTIONS),
    },
  });
}

Deno.serve(async (req: Request) => {
  // OPTIONS for RFC 8058 POST preflights from providers that send one; GET/POST do the work.
  if (req.method === "OPTIONS") return corsPreflightResponse(req, CORS_OPTIONS);
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeadersForRequest(req, CORS_OPTIONS),
    });
  }

  const siteUrl = (Deno.env.get("SITE_URL") || DEFAULT_SITE_URL).replace(/\/$/, "");
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";

  if (!UUID_RE.test(token)) {
    return htmlResponse(
      req,
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

  // GET only asks. Nothing is read or written here, so a link scanner's prefetch is a no-op and
  // the page is the same for a live token, a spent one, and a well-formed token that never
  // existed -- no membership oracle, same as the POST result below.
  if (req.method === "GET") {
    return htmlResponse(
      req,
      htmlPage({
        title: "Confirm unsubscribe",
        heading: "Unsubscribe from regulatory updates?",
        body:
          "Choose Unsubscribe me and this address stops receiving regulatory-update emails from CareMetric CareBase. Nothing has changed yet.",
        siteUrl,
        confirmAction: `?token=${token}`,
      }),
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("unsubscribe-updates is missing required Supabase environment variables");
    return htmlResponse(
      req,
      htmlPage({
        title: "Unsubscribe unavailable",
        heading: "We couldn't process that right now",
        body: "Please try again in a few minutes, or email hello@caremetric.ai and we'll remove you by hand.",
        siteUrl,
      }),
      500,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient
    .from("newsletter_subscribers")
    .update({ status: "unsubscribed" })
    .eq("unsubscribe_token", token);
  if (error) {
    console.error("unsubscribe-updates update failed", error.message);
    return htmlResponse(
      req,
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
    req,
    htmlPage({
      title: "You're unsubscribed",
      heading: "You're unsubscribed",
      body:
        "You won't receive any more regulatory-update emails from CareMetric CareBase at this address. The live feed stays free to read on the site any time.",
      siteUrl,
    }),
  );
});
