// Boot + wiring: one HTTP server carrying the express routes and the
// WebSocket upgrade router (pennfit's noServer pattern — every non-voice
// upgrade path is rejected explicitly).

import http from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { readGatewayConfig, type GatewayConfig } from "./config.js";
import { buildRegistry, type AppRegistry } from "./apps/registry.js";
import { buildHttpApp } from "./http/routes.js";
import {
  handleBrowserUpgrade,
  type BrowserTransportDeps,
} from "./transports/browser-ws.js";
import {
  handlePhoneUpgrade,
  type PhoneRuntime,
} from "./transports/twilio-media.js";
import { buildPhoneTargets } from "./phone/targets.js";
import { createPhoneStateStores } from "./phone/postgres-stores.js";
import {
  type PendingSessionStore,
} from "./session/pending-sessions.js";
import { ActiveSessionTracker } from "./session/voice-session.js";

export interface GatewayServerOptions {
  config: GatewayConfig | null;
  registry: AppRegistry;
  pendingStore?: PendingSessionStore;
  fetchImpl?: typeof fetch;
  webSocketFactory?: BrowserTransportDeps["webSocketFactory"];
  env?: NodeJS.ProcessEnv;
}

const REALTIME_PATH = /^\/apps\/([^/]+)\/realtime$/;
const PHONE_STREAM_PATH = "/phone/stream";

/** Phone channel needs the OpenAI key, Twilio token, a public base URL,
 *  and at least one routable target — otherwise it stays dark (503). */
function buildPhoneRuntime(
  opts: GatewayServerOptions,
  stores: ReturnType<typeof createPhoneStateStores>,
): PhoneRuntime | null {
  if (!opts.config?.twilioAuthToken || !opts.config.publicBaseUrl) return null;
  const targets = buildPhoneTargets(
    opts.registry,
    opts.env ?? process.env,
  );
  if (targets.length === 0) return null;
  console.log(
    JSON.stringify({
      evt: "voice.gateway.phone.state_store",
      mode: stores.mode,
    }),
  );
  return {
    targets,
    pendingStore: stores.pendingStore,
    transferStore: stores.transferStore,
    closeStores: stores.close,
    unclaimedSockets: { count: 0 },
  };
}

export function createGatewayServer(opts: GatewayServerOptions): http.Server {
  // Shared voice state (phone handoff + browser pending + usage meters).
  // When VOICE_STATE_DATABASE_URL is set every store is Postgres-backed so
  // multi-instance deploys share claim-once tickets and spend caps.
  const voiceState = createPhoneStateStores(opts.config?.voiceStateDatabaseUrl);
  const pendingStore = opts.pendingStore ?? voiceState.browserPendingStore;
  const tracker = new ActiveSessionTracker();
  const usage = voiceState.usage;
  const phone = buildPhoneRuntime(opts, voiceState);

  const app = buildHttpApp({
    config: opts.config,
    registry: opts.registry,
    pendingStore,
    tracker,
    usage,
    phone,
    fetchImpl: opts.fetchImpl,
  });

  const server = http.createServer(app);
  // Voice frames are small (browser mic chunks are tens of KB; Twilio media
  // frames are <1 KB JSON). ws's default maxPayload is 100 MB, which would let
  // any socket -- including pre-claim /phone/stream connections -- force the
  // gateway to buffer and parse huge frames. 1 MiB is far above any real frame.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://gateway.internal")
      .pathname;

    const realtime = REALTIME_PATH.exec(pathname);
    if (realtime) {
      if (!opts.config) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }
      void handleBrowserUpgrade(
        {
          config: opts.config,
          registry: opts.registry,
          pendingStore,
          tracker,
          usage,
          fetchImpl: opts.fetchImpl,
          webSocketFactory: opts.webSocketFactory,
        },
        wss,
        req,
        socket,
        head,
        realtime[1] ?? "",
      ).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            evt: "voice.browser.upgrade_error",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        try {
          socket.destroy();
        } catch {
          /* already closed */
        }
      });
      return;
    }

    if (pathname === PHONE_STREAM_PATH) {
      if (!opts.config || !phone) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }
      handlePhoneUpgrade(
        {
          config: opts.config,
          registry: opts.registry,
          phone,
          tracker,
          usage,
          webSocketFactory: opts.webSocketFactory,
        },
        wss,
        req,
        socket,
        head,
      );
      return;
    }

    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  });

  // Railway's edge proxy uses long-lived keep-alive connections; Node's
  // 5s default causes intermittent 502s (same setting as the carebase
  // static server).
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // Release the durable-store pool (and its sweep timer) with the server. The
  // promise is recorded so a shutdown can await it -- PostgresState.close() is
  // idempotent by early-return, so calling it a second time resolves at once
  // instead of handing back the in-flight pool.end(); the only way to wait for
  // that drain is to hold on to this exact promise.
  server.on("close", () => {
    // Always drain the shared voice-state pool (browser pending + usage + phone).
    storeCleanup.set(
      server,
      voiceState.close().catch(() => undefined),
    );
  });

  return server;
}

/**
 * Per-server durable-store cleanup, resolving once the pool has finished
 * draining. Populated by the "close" listener above; read by the shutdown path.
 */
const storeCleanup = new WeakMap<http.Server, Promise<void>>();

/**
 * Stops accepting connections and resolves only once the durable-store cleanup
 * has finished draining — not merely once it has been started.
 *
 * That distinction is the whole correctness of the shutdown path. `server.close()`
 * emits "close" to the cleanup listener and to this one-shot callback in the same
 * event turn, so exiting from the callback directly would terminate the in-flight
 * `pool.end()` (and any store query still running) and release the pool in name
 * only. Callers keep their own forced-exit timer: this promise is deliberately
 * unbounded, because the bound belongs to the platform's grace period, not here.
 */
export function closeServerAndDrainStores(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      void (storeCleanup.get(server) ?? Promise.resolve()).then(() => resolve());
    });
  });
}

/**
 * Railway sends SIGTERM on every redeploy/scale-down and SIGKILLs what is left
 * after its grace period. Stop accepting new connections and let the http
 * server's "close" hook release the Postgres pool, with a forced exit so a
 * long-lived voice WebSocket (which keeps the server from closing on its own)
 * can never hold shutdown past that grace period.
 *
 * Reaching this handler depends on the startCommand in
 * artifacts/voice-gateway/railway.json:
 * `exec node artifacts/voice-gateway/dist/index.js` (the path is relative to
 * the repo root, which is Railway's Root Directory for this service). Railway
 * signals the process it started, and both a `pnpm run` wrapper and a non-exec
 * `sh -c` keep the signal to themselves, leaving this process orphaned (and its
 * Postgres pool open) until SIGKILL.
 */
function installShutdownHandlers(server: http.Server): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ evt: "voice.gateway.shutdown", signal }));
    void closeServerAndDrainStores(server).then(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function main(): void {
  const config = readGatewayConfig();
  const registry = buildRegistry();
  const server = createGatewayServer({ config, registry });
  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  // Without a listener an "error" event is rethrown as an uncaught exception with no
  // indication of which port failed. Name the failure, and only give up when the bind
  // itself failed -- a post-listen error (an accept hitting EMFILE, say) is transient
  // and must not turn into a self-inflicted restart.
  server.on("error", (error) => {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(
      JSON.stringify({
        evt: "voice.gateway.server_error",
        port,
        code,
        message: error.message,
        listening: server.listening,
      }),
    );
    if (!server.listening) process.exit(1);
  });
  installShutdownHandlers(server);
  server.listen(port, () => {
    console.log(
      JSON.stringify({
        evt: "voice.gateway.listening",
        port,
        configured: config !== null,
        apps: [...registry.keys()],
      }),
    );
    if (!config) {
      console.log(
        JSON.stringify({
          evt: "voice.gateway.unconfigured",
          message:
            "OPENAI_API_KEY is not set — session routes will return 503 VOICE_UNCONFIGURED.",
        }),
      );
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
