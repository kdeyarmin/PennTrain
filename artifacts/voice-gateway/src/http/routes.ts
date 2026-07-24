// HTTP surface: /health plus the session-creation route. The WS routes are
// wired on the raw server's `upgrade` event in index.ts, not here.

import crypto from "node:crypto";
import express from "express";
import type { Request } from "express";
import { z } from "zod";
import type { GatewayConfig } from "../config.js";
import type { AppRegistry } from "../apps/registry.js";
import { verifyAppUser } from "../auth/verify-user.js";
import { corsHeaders, isOriginAllowed } from "./cors.js";
import {
  PENDING_SESSION_TTL_MS,
  type PendingSessionStore,
} from "../session/pending-sessions.js";
import type { ActiveSessionTracker } from "../session/voice-session.js";
import type { PhoneRuntime } from "../transports/twilio-media.js";
import { validateTwilioSignature } from "../phone/signature.js";
import {
  busyTwiml,
  connectStreamTwiml,
  dialTwiml,
  hangupTwiml,
  unavailableTwiml,
} from "../phone/twiml.js";

export interface GatewayHttpDeps {
  config: GatewayConfig | null;
  registry: AppRegistry;
  pendingStore: PendingSessionStore;
  tracker: ActiveSessionTracker;
  /** Shared-phone-number runtime; null when the phone channel is unconfigured. */
  phone: PhoneRuntime | null;
  fetchImpl?: typeof fetch;
}

const SESSION_BODY = z
  .object({
    facilityId: z.string().uuid().nullish(),
  })
  .strict();

/** Public wss:// origin for the WS URL — configured (VOICE_PUBLIC_WS_ORIGIN,
 *  else derived from VOICE_PUBLIC_BASE_URL), falling back to the request's
 *  forwarded headers only when neither is set. X-Forwarded-* values are
 *  client-influencable, so a configured public origin must always win --
 *  otherwise a crafted request could receive a wsUrl pointing at a foreign
 *  host and leak its claim-once session sid there. */
function wsOriginFor(config: GatewayConfig, req: Request): string {
  if (config.publicWsOrigin) return config.publicWsOrigin.replace(/\/+$/, "");
  if (config.publicBaseUrl) return config.publicBaseUrl.replace(/^http/, "ws");
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ??
    req.protocol;
  const host =
    (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ??
    req.headers.host ??
    "localhost";
  return `${proto === "https" ? "wss" : "ws"}://${host}`;
}

export function buildHttpApp(deps: GatewayHttpDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      configured: deps.config !== null,
      apps: [...deps.registry.keys()],
      phone: deps.phone !== null,
    });
  });

  // ---- Shared phone number (Twilio webhooks) -----------------------------
  // Point the ONE shared Twilio number's Voice webhook at /phone/inbound.
  // Both endpoints are gated by the Twilio request signature.

  const urlencoded = express.urlencoded({ extended: false });

  const twilioParams = (body: unknown): Record<string, string> =>
    Object.fromEntries(
      Object.entries((body ?? {}) as Record<string, unknown>).map(
        ([key, value]) => [key, String(value)],
      ),
    );

  const twilioGate = (
    req: Request,
    path: string,
  ): Record<string, string> | null => {
    const config = deps.config;
    if (!config?.twilioAuthToken || !config.publicBaseUrl) return null;
    const params = twilioParams(req.body);
    const ok = validateTwilioSignature(
      config.twilioAuthToken,
      req.headers["x-twilio-signature"] as string | undefined,
      `${config.publicBaseUrl}${path}`,
      params,
    );
    return ok ? params : null;
  };

  app.post("/phone/inbound", urlencoded, (req, res) => {
    if (!deps.config || !deps.phone) {
      res.status(503).type("text/xml").send(unavailableTwiml());
      return;
    }
    const params = twilioGate(req, "/phone/inbound");
    if (!params) {
      res.status(403).json({ error: "invalid_twilio_signature" });
      return;
    }
    // Phone calls share the browser sessions' cost caps: at capacity, a
    // polite busy line beats opening an uncapped Realtime session.
    const callSid = params.CallSid ?? "";
    if (!deps.tracker.canStart(`phone:${callSid}`, deps.config)) {
      res.type("text/xml").send(busyTwiml());
      return;
    }
    const sid = crypto.randomUUID();
    deps.phone.pendingStore.register({
      sid,
      callSid,
      from: params.From ?? "",
    });
    const wsBase = (deps.config.publicBaseUrl ?? "").replace(/^http/, "ws");
    res
      .type("text/xml")
      .send(
        connectStreamTwiml(
          `${wsBase}/phone/stream?sid=${sid}`,
          `${deps.config.publicBaseUrl}/phone/after`,
          { sid },
        ),
      );
  });

  // Fetched by Twilio when the media stream ends: either the triage agent
  // parked a transfer for this call (dial it) or the call is simply over.
  app.post("/phone/after", urlencoded, (req, res) => {
    if (!deps.config || !deps.phone) {
      res.status(503).type("text/xml").send(hangupTwiml());
      return;
    }
    const params = twilioGate(req, "/phone/after");
    if (!params) {
      res.status(403).json({ error: "invalid_twilio_signature" });
      return;
    }
    const number = deps.phone.transferStore.take(params.CallSid ?? "");
    res.type("text/xml").send(number ? dialTwiml(number) : hangupTwiml());
  });

  app.options("/apps/:appId/sessions", (req, res) => {
    const appDef = deps.registry.get(req.params.appId);
    const origin = req.headers.origin;
    if (!appDef || !origin || !isOriginAllowed(appDef, origin)) {
      res.status(403).end();
      return;
    }
    res.set(corsHeaders(origin)).status(204).end();
  });

  app.post("/apps/:appId/sessions", (req, res) => {
    void (async () => {
      const appDef = deps.registry.get(req.params.appId);
      if (!appDef) {
        res.status(404).json({ error: "unknown_app" });
        return;
      }

      const origin = req.headers.origin;
      if (!isOriginAllowed(appDef, origin)) {
        res.status(403).json({ error: "origin_not_allowed" });
        return;
      }
      if (origin) res.set(corsHeaders(origin));

      if (!deps.config) {
        // Env-presence gating: a stable 503 is the published "not set up
        // yet" behavior, mirroring pennfit's voice-config pattern.
        res.status(503).json({ error: "VOICE_UNCONFIGURED" });
        return;
      }

      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        res.status(401).json({ error: "missing_token" });
        return;
      }
      const jwt = auth.slice("Bearer ".length);

      const body = SESSION_BODY.safeParse(req.body ?? {});
      if (!body.success) {
        res.status(400).json({ error: "invalid_body" });
        return;
      }

      const verified = await verifyAppUser(appDef, jwt, deps.fetchImpl);
      if (!verified.ok) {
        res
          .status(verified.failure.status)
          .json({ error: verified.failure.code });
        return;
      }

      if (!deps.tracker.canStart(verified.user.userId, deps.config)) {
        res.status(429).json({ error: "too_many_sessions" });
        return;
      }

      const sessionId = crypto.randomUUID();
      deps.pendingStore.register({
        sessionId,
        appId: appDef.id,
        userId: verified.user.userId,
        role: verified.user.role,
        facilityId: body.data.facilityId ?? null,
        jwt,
        expiresAt: Date.now() + PENDING_SESSION_TTL_MS,
      });

      res.status(201).json({
        sessionId,
        wsUrl: `${wsOriginFor(deps.config, req)}/apps/${appDef.id}/realtime?sid=${sessionId}`,
        expiresIn: Math.floor(PENDING_SESSION_TTL_MS / 1_000),
      });
    })().catch((error: unknown) => {
      // A rejection here would otherwise surface as an unhandled promise
      // rejection and can take down the whole gateway process.
      console.error(
        JSON.stringify({
          evt: "voice.session.route_error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      if (!res.headersSent) {
        res.status(500).json({ error: "internal_error" });
      }
    });
  });

  return app;
}
