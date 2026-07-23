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
  /** Per-tool-call HTTP timeout for app callbacks. */
  toolTimeoutMs: number;
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

/** Returns null when the gateway is unconfigured (missing OPENAI_API_KEY). */
export function readGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig | null {
  const openaiApiKey = env.OPENAI_API_KEY;
  if (!openaiApiKey) return null;
  return {
    openaiApiKey,
    realtimeModel: env.OPENAI_REALTIME_MODEL || undefined,
    defaultVoice: env.VOICE_DEFAULT_VOICE || undefined,
    publicWsOrigin: env.VOICE_PUBLIC_WS_ORIGIN || undefined,
    maxSessionSeconds: intFromEnv(env, "VOICE_MAX_SESSION_SECONDS", 600),
    idleTimeoutSeconds: intFromEnv(env, "VOICE_IDLE_TIMEOUT_SECONDS", 90),
    maxConcurrentSessions: intFromEnv(env, "VOICE_MAX_CONCURRENT_SESSIONS", 5),
    maxSessionsPerUser: intFromEnv(env, "VOICE_MAX_SESSIONS_PER_USER", 1),
    toolTimeoutMs: intFromEnv(env, "VOICE_TOOL_TIMEOUT_MS", 60_000),
    playbackGraceMs: intFromEnv(env, "VOICE_PLAYBACK_GRACE_MS", 1_500),
  };
}
