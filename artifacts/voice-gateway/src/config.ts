// Gateway configuration — env-presence gating in the pennfit voice-config
// style: when the one hard requirement (OPENAI_API_KEY) is missing the
// gateway still boots and serves /health, but every session route replies
// 503 {code:"VOICE_UNCONFIGURED"}. A clean 503 tells the operator exactly
// what's wrong; a boot crash tells them nothing.

export interface GatewayConfig {
  openaiApiKey: string;
  /** Override for OpenAI's realtime model id (successor migrations). */
  realtimeModel?: string;
  /** Default Realtime voice; an app definition may override per app. */
  defaultVoice?: string;
  /**
   * Public origin for WebSocket URLs handed to browsers, e.g.
   * "wss://voice-gateway.up.railway.app". When unset, derived from the
   * session request's forwarded host/proto.
   */
  publicWsOrigin?: string;
  /** Hard per-session duration cap (cost control). */
  maxSessionSeconds: number;
  /** End a session after this long with no user audio arriving. */
  idleTimeoutSeconds: number;
  maxConcurrentSessions: number;
  maxSessionsPerUser: number;
  /**
   * Phone-channel concurrency budget, enforced IN ADDITION to the global
   * cap: phone sessions count against both, browser sessions only against
   * the global cap, so anonymous phone traffic can never exhaust the pool
   * used by authenticated in-app users.
   */
  maxConcurrentPhoneSessions: number;
  /** Per-caller (Twilio From number) cap: calls answered per rolling hour. */
  phoneCallsPerHour: number;
  /** Per-caller (Twilio From number) cap: session minutes per rolling hour. */
  phoneMinutesPerHour: number;
  /**
   * Global kill-switch: cumulative session minutes per UTC day across BOTH
   * channels. Exhausted → phone gets busy TwiML, new browser sessions get
   * 503 voice_budget_exhausted.
   */
  dailyMinutesBudget: number;
  /** Per-tool-call HTTP timeout for app callbacks. */
  toolTimeoutMs: number;
  /**
   * Twilio auth token — validates X-Twilio-Signature on phone webhooks.
   * Absent → the phone channel is unconfigured (503) while browser voice
   * keeps working.
   */
  twilioAuthToken?: string;
  /**
   * Public https origin of THIS gateway (e.g.
   * "https://voice-gateway.up.railway.app"). Required for the phone
   * channel: Twilio signatures are computed over the exact webhook URL,
   * and the TwiML stream/action URLs must be publicly reachable.
   */
  publicBaseUrl?: string;
  /**
   * Postgres URL for the DURABLE phone handoff stores (pending-call
   * tickets + parked transfer numbers). Set → those stores survive deploys
   * and hold claim-once across instances; unset → in-memory fallback,
   * acceptable only while the number is shared with pilot users.
   */
  voiceStateDatabaseUrl?: string;
  /**
   * How long the browser sink waits for delivered audio to finish playing
   * before a graceful close (a fixed grace — the browser transport has no
   * playback acknowledgement channel yet). Tests shrink this.
   */
  playbackGraceMs: number;
}

function intFromEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Hardest sane per-session cap: an hour of Realtime audio is already an
 *  operator mistake, not a use case. Boot validation clamps above this. */
const MAX_SESSION_SECONDS_CEILING = 3_600;

function warn(event: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ evt: event, ...fields }));
}

/**
 * Boot validation for the invariants the code otherwise only documents in
 * comments. Clamps (and warns) rather than crashing — a misconfigured cap
 * should degrade to a safe value, not take voice down entirely.
 *
 * - `idleTimeoutSeconds` must outlast `toolTimeoutMs`: the idle timer only
 *   resets on conversational activity, so an idle window shorter than one
 *   tool call would kill the session mid-lookup.
 * - `maxSessionSeconds` is a cost control; values past an hour defeat it.
 */
function validateConfig(config: GatewayConfig): GatewayConfig {
  if (config.idleTimeoutSeconds * 1_000 <= config.toolTimeoutMs) {
    const clamped = Math.ceil(config.toolTimeoutMs / 1_000) + 15;
    warn("voice.gateway.config.clamped", {
      field: "idleTimeoutSeconds",
      configured: config.idleTimeoutSeconds,
      clamped,
      reason: "idle timeout must outlast the tool-call timeout",
    });
    config.idleTimeoutSeconds = clamped;
  }
  if (config.maxSessionSeconds > MAX_SESSION_SECONDS_CEILING) {
    warn("voice.gateway.config.clamped", {
      field: "maxSessionSeconds",
      configured: config.maxSessionSeconds,
      clamped: MAX_SESSION_SECONDS_CEILING,
      reason: "per-session cap above one hour defeats the cost control",
    });
    config.maxSessionSeconds = MAX_SESSION_SECONDS_CEILING;
  }
  // Warn (don't fail): the phone front door works without the durable
  // store, but a deploy then drops live calls mid-handoff — fine for a
  // pilot, not for a published number.
  if (
    config.twilioAuthToken &&
    config.publicBaseUrl &&
    !config.voiceStateDatabaseUrl
  ) {
    warn("voice.gateway.config.phone_store_volatile", {
      field: "VOICE_STATE_DATABASE_URL",
      reason:
        "phone channel is configured but the handoff stores are in-memory — " +
        "a deploy drops live calls between Twilio's webhook and the media " +
        "stream. Set VOICE_STATE_DATABASE_URL before publishing the number.",
    });
  }
  return config;
}

/** Returns null when the gateway is unconfigured (missing OPENAI_API_KEY). */
export function readGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig | null {
  const openaiApiKey = env.OPENAI_API_KEY;
  if (!openaiApiKey) return null;
  return validateConfig({
    openaiApiKey,
    realtimeModel: env.OPENAI_REALTIME_MODEL || undefined,
    defaultVoice: env.VOICE_DEFAULT_VOICE || undefined,
    publicWsOrigin: env.VOICE_PUBLIC_WS_ORIGIN || undefined,
    maxSessionSeconds: intFromEnv(env, "VOICE_MAX_SESSION_SECONDS", 600),
    idleTimeoutSeconds: intFromEnv(env, "VOICE_IDLE_TIMEOUT_SECONDS", 90),
    maxConcurrentSessions: intFromEnv(env, "VOICE_MAX_CONCURRENT_SESSIONS", 5),
    maxSessionsPerUser: intFromEnv(env, "VOICE_MAX_SESSIONS_PER_USER", 1),
    maxConcurrentPhoneSessions: intFromEnv(
      env,
      "VOICE_MAX_CONCURRENT_PHONE_SESSIONS",
      3,
    ),
    phoneCallsPerHour: intFromEnv(env, "VOICE_PHONE_CALLS_PER_HOUR", 4),
    phoneMinutesPerHour: intFromEnv(env, "VOICE_PHONE_MINUTES_PER_HOUR", 20),
    dailyMinutesBudget: intFromEnv(env, "VOICE_DAILY_MINUTES_BUDGET", 240),
    // Timeout cascade for grounded lookups: the compliance copilot's own
    // Anthropic call times out at 60s (returning a voiceable error), the
    // voice-tools function aborts at 65s, and the gateway must outlast
    // BOTH so the app-owned, speakable error reaches the model instead of
    // a generic dispatcher failure.
    toolTimeoutMs: intFromEnv(env, "VOICE_TOOL_TIMEOUT_MS", 75_000),
    twilioAuthToken: env.TWILIO_AUTH_TOKEN || undefined,
    publicBaseUrl: env.VOICE_PUBLIC_BASE_URL?.replace(/\/+$/, "") || undefined,
    voiceStateDatabaseUrl: env.VOICE_STATE_DATABASE_URL || undefined,
    playbackGraceMs: intFromEnv(env, "VOICE_PLAYBACK_GRACE_MS", 1_500),
  });
}
