export type ProviderOutcome = "delivered" | "failed" | null;

export interface ProviderEventMapping {
  eventType: string;
  outcome: ProviderOutcome;
}

export interface VersionedNotificationTemplate {
  subject_template: string;
  body_template: string;
  allowed_variables: string[];
  version: number;
  template_key: string;
}

export function classifyNotificationDispatchStatus(input: {
  cancelled: boolean;
  attempted: number;
  accepted: number;
  failed: number;
  retryScheduled: number;
  persistenceErrors: number;
}): "succeeded" | "partial" | "failed" | "cancelled" {
  if (input.cancelled) return "cancelled";
  const unsuccessful = input.failed + input.retryScheduled +
    input.persistenceErrors;
  if (
    input.attempted > 0 && input.accepted === 0 &&
    unsuccessful >= input.attempted
  ) {
    return "failed";
  }
  return unsuccessful > 0 ? "partial" : "succeeded";
}

const TWILIO_SUCCESS = new Set(["delivered", "read"]);
const TWILIO_FAILURE = new Set(["failed", "undelivered", "canceled"]);
const TWILIO_PROGRESS = new Set(["accepted", "queued", "sending", "sent"]);

const SENDGRID_SUCCESS = new Set(["delivered"]);
const SENDGRID_FAILURE = new Set(["bounce", "dropped"]);
const SENDGRID_PROGRESS = new Set([
  "processed",
  "deferred",
  "spamreport",
  "spam report",
  "unsubscribe",
  "group_unsubscribe",
  "group_resubscribe",
]);

const TWILIO_OPT_OUT = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
]);
const TWILIO_OPT_IN = new Set(["START", "UNSTOP", "YES"]);
const TWILIO_HELP = new Set(["HELP", "INFO"]);

export function mapTwilioStatus(
  rawStatus: unknown,
): ProviderEventMapping | null {
  const status = typeof rawStatus === "string"
    ? rawStatus.trim().toLowerCase()
    : "";
  if (!status) return null;
  if (TWILIO_SUCCESS.has(status)) {
    return { eventType: status, outcome: "delivered" };
  }
  if (TWILIO_FAILURE.has(status)) {
    return { eventType: status, outcome: "failed" };
  }
  if (TWILIO_PROGRESS.has(status)) return { eventType: status, outcome: null };
  return null;
}

export function mapSendGridEvent(
  rawEvent: unknown,
): ProviderEventMapping | null {
  const event = typeof rawEvent === "string"
    ? rawEvent.trim().toLowerCase()
    : "";
  if (!event) return null;
  if (SENDGRID_SUCCESS.has(event)) {
    return { eventType: event, outcome: "delivered" };
  }
  if (SENDGRID_FAILURE.has(event)) {
    return { eventType: event, outcome: "failed" };
  }
  if (SENDGRID_PROGRESS.has(event)) return { eventType: event, outcome: null };
  return null;
}

export function mapSendGridConsent(
  rawEvent: unknown,
): "opt_in" | "opt_out" | null {
  const event = typeof rawEvent === "string"
    ? rawEvent.trim().toLowerCase()
    : "";
  if (event === "group_resubscribe") return "opt_in";
  if (
    event === "unsubscribe" || event === "group_unsubscribe" ||
    event === "spamreport" || event === "spam report"
  ) {
    return "opt_out";
  }
  return null;
}

export function normalizeTwilioConsentAction(
  rawOptOutType: unknown,
  rawBody: unknown,
): "opt_in" | "opt_out" | "help" | null {
  const optOutType = typeof rawOptOutType === "string"
    ? rawOptOutType.trim().toUpperCase()
    : "";
  if (optOutType === "STOP") return "opt_out";
  if (optOutType === "START") return "opt_in";
  if (optOutType === "HELP") return "help";

  const body = typeof rawBody === "string" ? rawBody.trim().toUpperCase() : "";
  if (TWILIO_OPT_OUT.has(body)) return "opt_out";
  if (TWILIO_OPT_IN.has(body)) return "opt_in";
  if (TWILIO_HELP.has(body)) return "help";
  return null;
}

export function parseFromAddress(
  raw: string,
): { email: string; name?: string } {
  const match = raw.match(/^(.*)<([^<>]+)>\s*$/);
  if (!match) return { email: raw.trim() };
  const name = match[1].trim().replace(/^"|"$/g, "");
  return { email: match[2].trim(), name: name || undefined };
}

export function normalizeSmsRecipient(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (
    raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15 &&
    !digits.startsWith("0")
  ) {
    return `+${digits}`;
  }
  return null;
}

export function renderProviderMessage(
  notificationType: string | null,
  title: string | null,
  body: string | null,
): { subject: string; body: string } {
  // Resident and support records can contain sensitive free text. External
  // notifications are intentionally generic and direct the user to the app.
  if (notificationType === "resident_compliance_due") {
    return {
      subject: "CareMetric CareBase compliance action required",
      body:
        "A compliance item requires attention. Sign in to CareMetric CareBase to review it securely.",
    };
  }
  if (notificationType === "support_ticket_update") {
    return {
      subject: "Your CareMetric CareBase support ticket has an update",
      body: "Sign in to CareMetric CareBase to review the update securely.",
    };
  }
  if (notificationType === "incident_reported") {
    return {
      subject: "A new incident report requires review",
      body:
        "A new incident report was submitted. Sign in to CareMetric CareBase to review it securely.",
    };
  }

  const subject = title?.trim() || "CareMetric CareBase notification";
  return { subject, body: body?.trim() || subject };
}

export function renderVersionedNotificationTemplate(
  template: VersionedNotificationTemplate,
  variables: Record<string, string>,
): { subject: string; body: string } {
  const allowed = new Set(template.allowed_variables);

  const render = (source: string): string => {
    const rendered = source.replace(
      /\{\{([a-z][a-z0-9_]*)\}\}/g,
      (_match, key: string) => {
        if (!allowed.has(key)) {
          throw new Error(
            `Template variable ${key} is not allowed`,
          );
        }
        return variables[key] ?? "";
      },
    );
    if (rendered.includes("{{") || rendered.includes("}}")) {
      throw new Error("Template contains an unknown or malformed placeholder");
    }
    return rendered.trim();
  };

  const subject = render(template.subject_template);
  const body = render(template.body_template);
  if (!subject || !body) {
    throw new Error("Template rendered empty provider content");
  }
  return { subject, body };
}

export function sanitizeProviderDetail(
  raw: unknown,
  maxLength = 500,
): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\+?[1-9]\d{7,14}/g, "[redacted-number]")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function isRetryableProviderStatus(status: number): boolean {
  // A 429 is an explicit provider rejection and is therefore safe to retry.
  // Transport errors are ambiguous and are quarantined instead of replayed.
  return status === 429;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(
  secret: string,
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
