import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

// Supabase Auth "Send Email" hook (Authentication -> Hooks in the dashboard): when enabled,
// Supabase Auth calls this function instead of using SMTP/its default mailer for every
// signup/recovery/invite/magic-link/email-change email, so this is the one place that needs to
// stay in sync with dispatch-notifications' SendGrid setup -- same SENDGRID_API_KEY/
// NOTIFICATION_FROM_EMAIL secrets, same provider, just HTML content instead of plain text.
// Authenticity is verified via the Standard Webhooks signature (SEND_EMAIL_HOOK_SECRET), since
// this endpoint is reachable over the public internet and verify_jwt can't apply -- Supabase's
// own infra calls it, not a user with a JWT.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new: string;
  token_hash_new: string;
}

interface HookUser {
  email: string;
  new_email?: string;
}

const SUBJECTS: Record<string, string> = {
  signup: "Confirm your email address",
  invite: "You've been invited to CareMetric Train",
  magiclink: "Your CareMetric Train sign-in link",
  recovery: "Reset your CareMetric Train password",
  email_change: "Confirm your new email address",
  reauthentication: "Your CareMetric Train verification code",
};

function buildVerifyUrl(supabaseUrl: string, emailData: EmailData): string {
  const params = new URLSearchParams({
    token: emailData.token_hash,
    type: emailData.email_action_type,
    redirect_to: emailData.redirect_to,
  });
  return `${supabaseUrl}/auth/v1/verify?${params.toString()}`;
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function buildEmail(user: HookUser, emailData: EmailData, supabaseUrl: string): { to: string; subject: string; html: string } {
  const actionType = emailData.email_action_type;
  const subject = SUBJECTS[actionType] ?? "CareMetric Train notification";

  if (actionType === "reauthentication") {
    return {
      to: user.email,
      subject,
      html: `<p>Your verification code is:</p><p style="font-size:24px;font-weight:bold">${emailData.token}</p><p>This code expires shortly. If you didn't request it, you can safely ignore this email.</p>`,
    };
  }

  const verifyUrl = buildVerifyUrl(supabaseUrl, emailData);
  const bodies: Record<string, string> = {
    signup: `<p>Follow the link below to confirm your email address and finish signing up.</p><p><a href="${verifyUrl}">Confirm email address</a></p>`,
    invite: `<p>You've been invited to create a CareMetric Train account.</p><p><a href="${verifyUrl}">Accept invitation</a></p>`,
    magiclink: `<p>Follow the link below to sign in. This link expires shortly and can only be used once.</p><p><a href="${verifyUrl}">Sign in</a></p>`,
    recovery: `<p>We received a request to reset your password.</p><p><a href="${verifyUrl}">Reset password</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
    email_change: `<p>Follow the link below to confirm ${user.new_email ?? "your new email address"} as your new email address.</p><p><a href="${verifyUrl}">Confirm new email address</a></p><p>If you didn't request this change, you can safely ignore this email.</p>`,
  };

  return {
    to: actionType === "email_change" ? (user.new_email ?? user.email) : user.email,
    subject,
    html: bodies[actionType] ?? `<p>Follow the link below to continue.</p><p><a href="${verifyUrl}">Continue</a></p>`,
  };
}

async function sendViaSendGrid(to: string, subject: string, html: string): Promise<void> {
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) throw new Error("SENDGRID_API_KEY is not set -- auth email delivery is not configured for this deployment.");

  const fromRaw = Deno.env.get("NOTIFICATION_FROM_EMAIL") || "CareMetric Train <notifications@caremetrictrain.com>";
  const match = fromRaw.match(/^(.*)<([^<>]+)>\s*$/);
  const from = match
    ? { email: match[2].trim(), name: match[1].trim().replace(/^"|"$/g, "") || undefined }
    : { email: fromRaw.trim() };

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from,
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const message = Array.isArray(data?.errors) && typeof data.errors[0]?.message === "string"
      ? data.errors[0].message
      : `SendGrid API returned ${resp.status}`;
    throw new Error(message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse(405, "method not allowed");

  const hookSecret = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace("v1,whsec_", "");
  if (!hookSecret) return errorResponse(500, "SEND_EMAIL_HOOK_SECRET is not set");

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  let user: HookUser;
  let emailData: EmailData;
  try {
    const verified = new Webhook(hookSecret).verify(payload, headers) as { user: HookUser; email_data: EmailData };
    user = verified.user;
    emailData = verified.email_data;
  } catch (error) {
    return errorResponse(401, error instanceof Error ? error.message : String(error));
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const { to, subject, html } = buildEmail(user, emailData, supabaseUrl);

  try {
    await sendViaSendGrid(to, subject, html);
  } catch (error) {
    return errorResponse(500, error instanceof Error ? error.message : String(error));
  }

  return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
});
