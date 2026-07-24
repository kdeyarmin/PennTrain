import { Webhook } from "npm:standardwebhooks@1.0.0";
import {
  type AuthEmailData,
  type AuthEmailMessage,
  type AuthEmailUser,
  buildAuthEmailMessages,
} from "../_shared/authEmail.ts";
import { parseFromAddress } from "../_shared/notificationDelivery.ts";
import { readTextBody, RequestBodyError } from "../_shared/requestBody.ts";

// Supabase Auth "Send Email" hook (Authentication -> Hooks in the dashboard): when enabled,
// Supabase Auth calls this function instead of using SMTP/its default mailer for every
// signup/recovery/invite/magic-link/email-change/reauthentication email, so this endpoint
// keeps Auth mail on the same SendGrid API path as application notification mail.
// Authenticity is verified via the Standard Webhooks signature (SEND_EMAIL_HOOK_SECRET), since
// this endpoint is reachable over the public internet and verify_jwt can't apply -- Supabase's
// own infra calls it, not a user with a JWT.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { http_code: status, message } }),
    {
      status,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    },
  );
}

async function sendViaSendGrid(message: AuthEmailMessage): Promise<void> {
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) {
    throw new Error(
      "SENDGRID_API_KEY is not set -- auth email delivery is not configured for this deployment.",
    );
  }

  const from = parseFromAddress(
    Deno.env.get("NOTIFICATION_FROM_EMAIL") ||
      "CareMetric CareBase <notifications@cmcarebase.com>",
  );

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: message.to }] }],
      from,
      subject: message.subject,
      content: [
        { type: "text/plain", value: message.text },
        { type: "text/html", value: message.html },
      ],
    }),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const detail =
      Array.isArray(data?.errors) && typeof data.errors[0]?.message === "string"
        ? data.errors[0].message
        : `SendGrid API returned ${resp.status}`;
    throw new Error(detail);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return errorResponse(405, "method not allowed");

  const hookSecret = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace(
    "v1,whsec_",
    "",
  );
  if (!hookSecret) {
    return errorResponse(500, "SEND_EMAIL_HOOK_SECRET is not set");
  }

  let payload: string;
  try {
    // Auth hook payloads are small; cap well below abuse size while keeping headroom
    // for long email_action_links.
    payload = await readTextBody(req, 65_536);
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.status, error.message);
    return errorResponse(400, "invalid body");
  }
  const headers = Object.fromEntries(req.headers);

  let user: AuthEmailUser;
  let emailData: AuthEmailData;
  try {
    const verified = new Webhook(hookSecret).verify(payload, headers) as {
      user: AuthEmailUser;
      email_data: AuthEmailData;
    };
    user = verified.user;
    emailData = verified.email_data;
  } catch (error) {
    console.error("send-auth-email webhook verification failed", error);
    return errorResponse(401, "invalid webhook signature");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return errorResponse(500, "SUPABASE_URL is not set");

  const messages = buildAuthEmailMessages(user, emailData, supabaseUrl);
  if (messages.length === 0) {
    return errorResponse(
      400,
      "No auth email messages could be built for this payload",
    );
  }

  try {
    for (const message of messages) await sendViaSendGrid(message);
  } catch (error) {
    console.error("send-auth-email delivery failed", error);
    return errorResponse(500, "auth email delivery failed");
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});
