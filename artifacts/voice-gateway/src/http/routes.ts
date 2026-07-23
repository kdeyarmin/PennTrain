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

export interface GatewayHttpDeps {
  config: GatewayConfig | null;
  registry: AppRegistry;
  pendingStore: PendingSessionStore;
  tracker: ActiveSessionTracker;
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
