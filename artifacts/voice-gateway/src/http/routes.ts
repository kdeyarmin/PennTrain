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
import type { UsageLimits } from "../session/usage-limits.js";
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
  usage: UsageLimits;
  /** Shared-phone-number runtime; null when the phone channel is unconfigured. */
  phone: PhoneRuntime | null;
  fetchImpl?: typeof fetch;
}

const SESSION_BODY = z
  .object({
    facilityId: z.string().uuid().nullish(),
  })
  .strict();

/** Public wss:// origin for the WS URL — configured, or derived from the
 *  proxy's forwarded headers (Railway sets x-forwarded-proto/host). */
function wsOriginFor(config: GatewayConfig, req: Request): string {
  if (config.publicWsOrigin) return config.publicWsOrigin.replace(/\/+$/, "");
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ??
    req.protocol;
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ??
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

  // The store calls are async (Postgres when VOICE_STATE_DATABASE_URL is
  // set). A store failure answers polite busy TwiML on HTTP 200 — Twilio
  // only renders TwiML bodies on 2xx.
  app.post("/phone/inbound", urlencoded, (req, res) => {
    void (async () => {
      if (!deps.config || !deps.phone) {
        // HTTP 200 on purpose: Twilio only renders TwiML bodies on 2xx, so a
        // 5xx would play its generic error instead of this message.
        res.status(200).type("text/xml").send(unavailableTwiml());
        return;
      }
      const config = deps.config;
      const phone = deps.phone;
      const params = twilioGate(req, "/phone/inbound");
      if (!params) {
        res.status(403).json({ error: "invalid_twilio_signature" });
        return;
      }
      const callSid = params.CallSid ?? "";
      const from = params.From ?? "";
      const respondConnect = (sid: string): void => {
        const wsBase = (config.publicBaseUrl ?? "").replace(/^http/, "ws");
        res
          .type("text/xml")
          .send(
            connectStreamTwiml(
              `${wsBase}/phone/stream?sid=${sid}`,
              `${config.publicBaseUrl}/phone/after`,
              { sid },
            ),
          );
      };
      // CallSid idempotency: a Twilio retry (or a replayed capture of the
      // signed request) reuses the live ticket rather than minting another
      // Realtime handoff; once the call has connected, replays get busy.
      // These pre-checks also keep replays from burning the caller's
      // rolling-hour counters below.
      if (callSid) {
        const existing = await phone.pendingStore.activeTicketFor(callSid);
        if (existing) {
          respondConnect(existing.sid);
          return;
        }
        if (await phone.pendingStore.wasClaimed(callSid)) {
          res.type("text/xml").send(busyTwiml());
          return;
        }
      }
      // Cost controls, all BEFORE any Realtime session opens: the global
      // daily minutes budget, this caller's rolling-hour call/minute caps,
      // and the phone-channel + global concurrency budgets.
      if (deps.usage.dailyBudget.isExhausted(config)) {
        res.type("text/xml").send(busyTwiml());
        return;
      }
      if (deps.usage.phoneCallers.check(from, config) !== "ok") {
        res.type("text/xml").send(busyTwiml());
        return;
      }
      if (!deps.tracker.canStart(`phone:${callSid}`, config, "phone")) {
        res.type("text/xml").send(busyTwiml());
        return;
      }
      const sid = crypto.randomUUID();
      // register() resolves the ticket that is actually live for this
      // CallSid — the new one, or (racing replays across instances) the
      // one that won the unique-index race; null means the call already
      // connected, so the replay gets busy.
      const ticket = await phone.pendingStore.register({ sid, callSid, from });
      if (!ticket) {
        res.type("text/xml").send(busyTwiml());
        return;
      }
      deps.usage.phoneCallers.recordCall(from);
      respondConnect(ticket.sid);
    })().catch((err: unknown) => {
      console.error(
        JSON.stringify({
          evt: "phone.inbound.store_error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      if (!res.headersSent) {
        res.status(200).type("text/xml").send(busyTwiml());
      }
    });
  });

  // Fetched by Twilio when the media stream ends: either the triage agent
  // parked a transfer for this call (dial it) or the call is simply over.
  app.post("/phone/after", urlencoded, (req, res) => {
    void (async () => {
      if (!deps.config || !deps.phone) {
        // 200 for the same reason as /phone/inbound: TwiML on 5xx is ignored.
        res.status(200).type("text/xml").send(hangupTwiml());
        return;
      }
      const params = twilioGate(req, "/phone/after");
      if (!params) {
        res.status(403).json({ error: "invalid_twilio_signature" });
        return;
      }
      const number = await deps.phone.transferStore.take(params.CallSid ?? "");
      res.type("text/xml").send(number ? dialTwiml(number) : hangupTwiml());
    })().catch((err: unknown) => {
      console.error(
        JSON.stringify({
          evt: "phone.after.store_error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      if (!res.headersSent) {
        res.status(200).type("text/xml").send(hangupTwiml());
      }
    });
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

      // Daily minutes kill-switch (both channels share the budget). After
      // auth on purpose: anonymous probes learn nothing about spend state.
      if (deps.usage.dailyBudget.isExhausted(deps.config)) {
        res.status(503).json({ error: "voice_budget_exhausted" });
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
    })();
  });

  return app;
}
