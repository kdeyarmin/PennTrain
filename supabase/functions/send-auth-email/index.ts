import { Webhook } from "npm:standardwebhooks@1.0.0";

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
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

interface AuthEmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const SUBJECTS: Record<string, string> = {
  signup: "Confirm your email address",
  invite: "You've been invited to CareMetric CareBase",
  magiclink: "Your CareMetric CareBase sign-in link",
  recovery: "Reset your CareMetric CareBase password",
  email_change: "Confirm your new email address",
  reauthentication: "Your CareMetric CareBase verification code",
};

function buildVerifyUrl(
  supabaseUrl: string,
  emailData: EmailData,
  tokenHash = emailData.token_hash,
): string {
  const params = new URLSearchParams({
    token: tokenHash,
    type: emailData.email_action_type,
    redirect_to: emailData.redirect_to,
  });
  return `${supabaseUrl}/auth/v1/verify?${params.toString()}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkEmail(
  to: string,
  subject: string,
  intro: string,
  cta: string,
  url: string,
  outro?: string,
): AuthEmailMessage {
  const safeUrl = escapeHtml(url);
  const safeIntro = escapeHtml(intro);
  const safeCta = escapeHtml(cta);
  const safeOutro = outro ? `<p>${escapeHtml(outro)}</p>` : "";
  return {
    to,
    subject,
    text: `${intro}\n\n${cta}: ${url}${outro ? `\n\n${outro}` : ""}`,
    html:
      `<p>${safeIntro}</p><p><a href="${safeUrl}">${safeCta}</a></p>${safeOutro}`,
  };
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { http_code: status, message } }),
    {
      status,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    },
  );
}

function buildEmails(
  user: HookUser,
  emailData: EmailData,
  supabaseUrl: string,
): AuthEmailMessage[] {
  const actionType = emailData.email_action_type;
  const subject = SUBJECTS[actionType] ?? "CareMetric CareBase notification";

  if (actionType === "reauthentication") {
    return [{
      to: user.email,
      subject,
      text: `Your verification code is: ${emailData.token}

This code expires shortly. If you didn't request it, you can safely ignore this email.`,
      html:
        `<p>Your verification code is:</p><p style="font-size:24px;font-weight:bold">${
          escapeHtml(emailData.token)
        }</p><p>This code expires shortly. If you didn't request it, you can safely ignore this email.</p>`,
    }];
  }

  if (actionType === "email_change") {
    const messages: AuthEmailMessage[] = [];
    const newEmail = user.new_email ?? user.email;

    // Supabase's Secure Email Change payload intentionally uses counterintuitive
    // field names for backwards compatibility: token_hash_new verifies the
    // current email, while token_hash verifies the new email. When both token
    // pairs are present we must send both messages or secure email changes can
    // never complete.
    if (emailData.token && emailData.token_hash_new) {
      messages.push(linkEmail(
        user.email,
        subject,
        `Confirm that you want to change your CareMetric CareBase email address to ${newEmail}.`,
        "Confirm email change",
        buildVerifyUrl(supabaseUrl, emailData, emailData.token_hash_new),
        "If you didn't request this change, you can safely ignore this email.",
      ));
    }

    const newEmailTokenHash = emailData.token_hash || emailData.token_hash_new;
    if (newEmailTokenHash) {
      messages.push(linkEmail(
        newEmail,
        subject,
        "Confirm this address as your new CareMetric CareBase email address.",
        "Confirm new email address",
        buildVerifyUrl(supabaseUrl, emailData, newEmailTokenHash),
        "If you didn't request this change, you can safely ignore this email.",
      ));
    }

    return messages;
  }

  const verifyUrl = buildVerifyUrl(supabaseUrl, emailData);
  switch (actionType) {
    case "signup":
      return [
        linkEmail(
          user.email,
          subject,
          "Follow the link below to confirm your email address and finish signing up.",
          "Confirm email address",
          verifyUrl,
        ),
      ];
    case "invite":
      return [
        linkEmail(
          user.email,
          subject,
          "You've been invited to create a CareMetric CareBase account.",
          "Accept invitation",
          verifyUrl,
        ),
      ];
    case "magiclink":
      return [
        linkEmail(
          user.email,
          subject,
          "Follow the link below to sign in. This link expires shortly and can only be used once.",
          "Sign in",
          verifyUrl,
        ),
      ];
    case "recovery":
      return [
        linkEmail(
          user.email,
          subject,
          "We received a request to reset your password.",
          "Reset password",
          verifyUrl,
          "If you didn't request this, you can safely ignore this email.",
        ),
      ];
    default:
      return [
        linkEmail(
          user.email,
          subject,
          "Follow the link below to continue.",
          "Continue",
          verifyUrl,
        ),
      ];
  }
}

async function sendViaSendGrid(message: AuthEmailMessage): Promise<void> {
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) {
    throw new Error(
      "SENDGRID_API_KEY is not set -- auth email delivery is not configured for this deployment.",
    );
  }

  const fromRaw = Deno.env.get("NOTIFICATION_FROM_EMAIL") ||
    "CareMetric CareBase <notifications@cmcarebase.com>";
  const match = fromRaw.match(/^(.*)<([^<>]+)>\s*$/);
  const from = match
    ? {
      email: match[2].trim(),
      name: match[1].trim().replace(/^"|"$/g, "") || undefined,
    }
    : { email: fromRaw.trim() };

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
    const message =
      Array.isArray(data?.errors) && typeof data.errors[0]?.message === "string"
        ? data.errors[0].message
        : `SendGrid API returned ${resp.status}`;
    throw new Error(message);
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

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  let user: HookUser;
  let emailData: EmailData;
  try {
    const verified = new Webhook(hookSecret).verify(payload, headers) as {
      user: HookUser;
      email_data: EmailData;
    };
    user = verified.user;
    emailData = verified.email_data;
  } catch (error) {
    return errorResponse(
      401,
      error instanceof Error ? error.message : String(error),
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const messages = buildEmails(user, emailData, supabaseUrl);
  if (messages.length === 0) {
    return errorResponse(
      400,
      "No auth email messages could be built for this payload",
    );
  }

  try {
    await Promise.all(messages.map((message) => sendViaSendGrid(message)));
  } catch (error) {
    return errorResponse(
      500,
      error instanceof Error ? error.message : String(error),
    );
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});
