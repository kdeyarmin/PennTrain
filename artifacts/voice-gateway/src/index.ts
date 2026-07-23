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
import {
  PhonePendingStore,
  TransferActionStore,
} from "./phone/pending-calls.js";
import {
  InMemoryPendingSessionStore,
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
function buildPhoneRuntime(opts: GatewayServerOptions): PhoneRuntime | null {
  if (!opts.config?.twilioAuthToken || !opts.config.publicBaseUrl) return null;
  const targets = buildPhoneTargets(
    opts.registry,
    opts.env ?? process.env,
  );
  if (targets.length === 0) return null;
  return {
    targets,
    pendingStore: new PhonePendingStore(),
    transferStore: new TransferActionStore(),
  };
}

export function createGatewayServer(opts: GatewayServerOptions): http.Server {
  const pendingStore = opts.pendingStore ?? new InMemoryPendingSessionStore();
  const tracker = new ActiveSessionTracker();
  const phone = buildPhoneRuntime(opts);

  const app = buildHttpApp({
    config: opts.config,
    registry: opts.registry,
    pendingStore,
    tracker,
    phone,
    fetchImpl: opts.fetchImpl,
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

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
      handleBrowserUpgrade(
        {
          config: opts.config,
          registry: opts.registry,
          pendingStore,
          tracker,
          fetchImpl: opts.fetchImpl,
          webSocketFactory: opts.webSocketFactory,
        },
        wss,
        req,
        socket,
        head,
        realtime[1] ?? "",
      );
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

  return server;
}

function main(): void {
  const config = readGatewayConfig();
  const registry = buildRegistry();
  const server = createGatewayServer({ config, registry });
  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
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
