import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { resolveAppRedirect } from "../_shared/appRedirect.ts";
import { requireFreshAal2 } from "../_shared/privilegedIdentity.ts";
import { isDemoOrganization } from "../_shared/demoTenant.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import {
  buildAuthEmailMessages,
  type AuthEmailData,
} from "../_shared/authEmail.ts";
import { parseFromAddress } from "../_shared/notificationDelivery.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_APP_ORIGIN = "https://cmcarebase.com";
const DEFAULT_ALLOWED_APP_ORIGINS = new Set(["https://cmcarebase.com"]);

function allowedRedirectOrigins(): Set<string> {
  const configured = (Deno.env.get("SIGNUP_REDIRECT_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_APP_ORIGINS, ...configured]);
}

function resolveRedirectTo(candidate: string | null | undefined): string {
  const fallbackOrigin = (Deno.env.get("PUBLIC_APP_URL") ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, "");
  const allowLocalhostRedirects = Deno.env.get("ALLOW_LOCALHOST_SIGNUP_REDIRECTS") === "true";
  return resolveAppRedirect(
    candidate ?? undefined,
    `${fallbackOrigin}/reset-password`,
    allowedRedirectOrigins(),
    allowLocalhostRedirects,
  );
}

async function sendViaSendGrid(message: { to: string; subject: string; text: string; html: string }) {
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) {
    throw new Error("Email delivery is not configured for this deployment");
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
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(req, { error: "Service is not configured" }, 503);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json(req, { error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, organization_id, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json(req, { error: "Caller profile not found or inactive" }, 403);
  }

  let body: { invitation_id?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const invitationId = typeof body.invitation_id === "string" ? body.invitation_id.trim() : "";
  if (!UUID_PATTERN.test(invitationId)) {
    return json(req, { error: "invitation_id must be a valid UUID" }, 400);
  }

  const callerRole = callerProfile.role as string;
  const callerOrgId = callerProfile.organization_id as string | null;
  if (!["platform_admin", "org_admin", "facility_manager"].includes(callerRole)) {
    return json(req, { error: "not authorized to resend invitations" }, 403);
  }

  try {
    if (await isDemoOrganization(callerClient, callerOrgId)) {
      return json(req, { error: "Demo workspaces cannot resend invitations" }, 403);
    }
  } catch (error) {
    return json(req, { error: error instanceof Error ? error.message : "Unable to verify demo workspace" }, 500);
  }

  const assurance = await requireFreshAal2(callerClient, "identity_admin");
  if (!assurance.ok) return json(req, { error: assurance.error }, assurance.status);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: invitation, error: invitationError } = await adminClient
    .from("user_invitation_lifecycle")
    .select("*")
    .eq("id", invitationId)
    .maybeSingle();
  if (invitationError) {
    return json(req, { error: "Unable to load invitation" }, 500);
  }
  if (!invitation) {
    return json(req, { error: "Invitation not found" }, 404);
  }

  if (callerRole !== "platform_admin") {
    if (invitation.organization_id !== callerOrgId) {
      // Same 404 as "not found": a closed foreign invitation used to 409
      // and a live one 403, which made this endpoint a cross-tenant oracle.
      return json(req, { error: "Invitation not found" }, 404);
    }
    if (callerRole === "facility_manager" && !["trainer", "employee"].includes(invitation.invited_role)) {
      return json(req, { error: "Facility managers may only resend trainer or employee invitations" }, 403);
    }
  }

  if (["accepted", "revoked"].includes(invitation.status)) {
    return json(req, { error: "Closed invitations cannot be resent" }, 409);
  }

  let redirectTo: string;
  try {
    redirectTo = resolveRedirectTo(invitation.redirect_to);
  } catch (error) {
    return json(req, { error: error instanceof Error ? error.message : "Invalid invite redirect URL" }, 400);
  }

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "invite",
    email: invitation.email,
    options: {
      redirectTo,
      data: {
        first_name: invitation.first_name,
        last_name: invitation.last_name,
      },
    },
  });
  if (linkError || !linkData?.properties) {
    return json(req, { error: linkError?.message ?? "Unable to generate invitation link" }, 400);
  }

  const properties = linkData.properties as {
    action_link?: string;
    email_otp?: string;
    hashed_token?: string;
    redirect_to?: string;
  };

  const emailData: AuthEmailData = {
    token: properties.email_otp,
    token_hash: properties.hashed_token,
    redirect_to: properties.redirect_to ?? redirectTo,
    email_action_type: "invite",
    site_url: (Deno.env.get("PUBLIC_APP_URL") ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, ""),
  };

  try {
    const messages = buildAuthEmailMessages(
      { email: invitation.email },
      emailData,
      supabaseUrl,
    );
    // Prefer the generated action_link when present so the invite lands on the same verify path
    // GoTrue would have emailed on the original inviteUserByEmail call.
    if (properties.action_link) {
      for (const message of messages) {
        message.text = message.text.replace(/https?:\/\/\S+/g, properties.action_link);
        message.html = message.html.replace(/href="[^"]+"/g, `href="${properties.action_link}"`);
      }
    }
    for (const message of messages) {
      await sendViaSendGrid(message);
    }
  } catch (error) {
    return json(req, {
      error: error instanceof Error ? error.message : "Invitation email could not be delivered",
    }, 502);
  }

  const { data: receipt, error: receiptError } = await adminClient.rpc("record_user_invitation_resent", {
    p_invitation_id: invitationId,
  });
  if (receiptError) {
    console.error("resend-invitation receipt failed", {
      invitation_id: invitationId,
      error: receiptError.message,
    });
    return json(req, {
      error: "Invitation email was sent but the lifecycle receipt could not be updated",
    }, 500);
  }

  return json(req, {
    success: true,
    invitation_id: invitationId,
    email: invitation.email,
    receipt,
  });
});
