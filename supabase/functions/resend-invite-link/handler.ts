import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
import { clientIp } from "../_shared/clientIp.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { resolveAppRedirect } from "../_shared/appRedirect.ts";

// Public, unauthenticated resend (verify_jwt: false). The invitee whose link expired has no
// session. Abuse control is reserve_invite_resend, called before any lookup. Every outcome the
// caller can observe is the same acknowledgement, so the response cannot say whether the address
// was invited, confirmed, revoked, or rate-limited.

export const INVITE_RESEND_ACK = "If you were invited, a new link is on its way.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_APP_ORIGIN = "https://cmcarebase.com";
const DEFAULT_ALLOWED_APP_ORIGINS = new Set(["https://cmcarebase.com"]);

type EnvReader = (name: string) => string | undefined;
// deno-lint-ignore no-explicit-any
type ClientFactory = (url: string, key: string) => any;

function json(req: Request, body: unknown, status = 200, getEnv?: EnvReader) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req, { getEnv }) },
  });
}

function ack(req: Request, getEnv?: EnvReader) {
  return json(req, { ok: true, message: INVITE_RESEND_ACK }, 200, getEnv);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function allowedRedirectOrigins(getEnv: EnvReader): Set<string> {
  const configured = (getEnv("SIGNUP_REDIRECT_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_APP_ORIGINS, ...configured]);
}

function resolveRedirectTo(candidate: string | undefined, getEnv: EnvReader): string {
  const fallbackOrigin = (getEnv("PUBLIC_APP_URL") ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, "");
  const fallback = `${fallbackOrigin}/reset-password`;
  try {
    return resolveAppRedirect(
      candidate,
      fallback,
      allowedRedirectOrigins(getEnv),
      getEnv("ALLOW_LOCALHOST_SIGNUP_REDIRECTS") === "true",
    );
  } catch {
    return fallback;
  }
}

export function createResendInviteLinkHandler({
  createClient,
  getEnv = (name) => Deno.env.get(name),
}: {
  createClient: ClientFactory;
  getEnv?: EnvReader;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return corsPreflightResponse(req, { getEnv });
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405, getEnv);

    let body: { email?: unknown; redirect_to?: unknown };
    try {
      body = await readJsonBody(req);
    } catch (error) {
      if (error instanceof RequestBodyError && error.status === 413) {
        return json(req, { error: error.message }, 413, getEnv);
      }
      return ack(req, getEnv);
    }

    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Service is not configured" }, 503, getEnv);
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 320) : "";
    const redirectCandidate = typeof body.redirect_to === "string" ? body.redirect_to : undefined;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const ip = clientIp(req);
    const hashPepper = getEnv("SIGNUP_RATE_LIMIT_PEPPER") ?? serviceRoleKey;
    const emailHash = await sha256Hex(`invite-resend:email:${email}:${hashPepper}`);
    const ipHash = await sha256Hex(`invite-resend:ip:${ip}:${hashPepper}`);
    const maxIpPerHour = parsePositiveInteger(getEnv("INVITE_RESEND_MAX_IP_PER_HOUR"), 5);
    const maxEmailPerDay = parsePositiveInteger(getEnv("INVITE_RESEND_MAX_EMAIL_PER_DAY"), 3);

    // Reserve first, including for an empty or unknown address, so the limit is spent
    // before the answer could depend on whether anyone was invited.
    const { error: limitError } = await adminClient.rpc("reserve_invite_resend", {
      p_email_hash: emailHash,
      p_ip_hash: ipHash,
      p_max_ip_per_hour: maxIpPerHour,
      p_max_email_per_day: maxEmailPerDay,
    });
    if (limitError) {
      if (!String(limitError.message ?? "").includes("invite_resend_rate_limited")) {
        console.error("resend-invite-link: limiter unavailable");
      }
      return ack(req, getEnv);
    }

    if (!EMAIL_RE.test(email)) return ack(req, getEnv);

    const { data: userId, error: lookupError } = await adminClient.rpc("pending_invite_user_id", {
      p_email: email,
    });
    if (lookupError || typeof userId !== "string" || userId.length === 0) {
      if (lookupError) console.error("resend-invite-link: lookup unavailable");
      return ack(req, getEnv);
    }

    const redirectTo = resolveRedirectTo(redirectCandidate, getEnv);
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inviteError) {
      console.error("resend-invite-link: send failed", {
        status: (inviteError as { status?: number }).status ?? null,
        code: (inviteError as { code?: string }).code ?? null,
      });
    }
    return ack(req, getEnv);
  };
}
