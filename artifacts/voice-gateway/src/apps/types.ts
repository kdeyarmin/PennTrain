// The multi-app seam. Every app the gateway serves is one AppDefinition:
// its own prompt, tools, auth verification config, and origins. The engine
// (bridge/realtime-client/transports) never special-cases an app.

import type { RealtimeNoiseReduction } from "../core/realtime-client.js";
import type { AppToolSet } from "../core/tool-types.js";

export interface AppAuthConfig {
  /** The app's Supabase project URL — end-user JWTs are verified against it. */
  supabaseUrl: string;
  /** The app's public anon key (browser-safe by design; RLS does the gating). */
  anonKey: string;
  /** `profiles.role` values allowed to start voice sessions. */
  allowedRoles: readonly string[];
}

/** Server-bound identity for one session. The model never selects any of
 *  these — they are fixed at session creation from the verified JWT. */
export interface SessionContext {
  appId: string;
  sessionId: string;
  userId: string;
  role: string;
  facilityId: string | null;
}

export interface AppDefinition {
  id: string;
  displayName: string;
  auth: AppAuthConfig;
  /** Browser origins allowed to create sessions / open the WS. */
  allowedOrigins: readonly string[];
  /** HTTPS endpoint that executes this app's tools (receives the user JWT). */
  toolCallbackUrl: string;
  tools: AppToolSet;
  buildInstructions(ctx: SessionContext): string;
  /** Realtime voice override; gateway default when unset. */
  voice?: string;
  /** near_field suits browser mics; far_field telephony. */
  noiseReduction?: RealtimeNoiseReduction;
  /** Greet the user before they speak (true for the in-app assistant). */
  agentSpeaksFirst: boolean;
}
