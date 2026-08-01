/**
 * The learning bridge in a real browser.
 *
 * learningRuntimeBridge.integration.test.ts already drives the shipped adapter against the host
 * helpers, but it stubs the frame, so it proves the protocol and nothing about the environment the
 * protocol was designed around. Everything load-bearing in that design is a browser behavior:
 *
 *   - the frame is sandboxed without allow-same-origin, so its origin is opaque -- which is *why*
 *     the bridge authenticates by nonce and event.source instead of by origin;
 *   - event.source must identify the frame across two real documents;
 *   - targetOrigin "*" must actually reach an opaque-origin frame.
 *
 * A stub can be made to agree with any of those. Only a browser can disagree.
 *
 * Both sides here are real: the page loads the shipped `/learning-runtime-bridge.js`, and the host
 * messages are built and validated by the same helpers the player uses -- constructed in Node,
 * posted from the page, then read back and checked. This suite needs no Supabase credentials, so
 * unlike the authenticated journeys it runs on every CI run.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  buildRuntimeInitMessage,
  isRuntimeHandshakeRequest,
  parseRuntimeBridgeMessage,
  RUNTIME_FRAME_SANDBOX,
  type LaunchSession,
} from "../src/lib/learningRuntime";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_URL = "/e2e-scorm-fixture.html";
const ADAPTER_URL = "/learning-runtime-bridge.js";
const FIXTURE_HTML = readFileSync(join(HERE, "fixtures", "scorm-package.html"), "utf8");
/** The shipped adapter, byte for byte -- the same file the app serves and packages include. */
const ADAPTER_JS = readFileSync(join(HERE, "..", "public", "learning-runtime-bridge.js"), "utf8");

const launch: LaunchSession = {
  sessionId: "browser-session-1",
  packageId: "browser-package-1",
  assignmentId: "browser-assignment-1",
  employeeId: "browser-employee-1",
  standard: "scorm_1_2",
  entryPoint: "index.html",
  storageBucket: "learning-packages",
  storagePath: "org/pkg.zip",
  registrationKey: "reg:browser-assignment-1:abc",
  launchNonce: "browser-nonce-1",
  expiresAt: "2026-08-01T00:00:00Z",
  nextSequenceNumber: 1,
  reused: false,
};

interface CapturedMessage {
  data: unknown;
  fromFrame: boolean;
  origin: string;
}

test.describe("learning package bridge in a browser", () => {
  test("completes the handshake across a sandboxed opaque-origin frame", async ({ page }) => {
    await page.route(`**${FIXTURE_URL}`, (route) =>
      route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }));

    // Serve the adapter to the frame directly rather than letting it fetch the app's copy.
    // Chrome blocks an opaque-origin document from reaching a private/loopback address
    // ("Permission was denied for this request to access the `unknown` address space"), so on a
    // localhost test server the frame cannot load /learning-runtime-bridge.js over the network at
    // all. The bytes are identical either way -- read from the same shipped file -- so this
    // sidesteps a local-only delivery restriction without weakening what is under test.
    // See docs/LEARNING_PACKAGE_BRIDGE.md: packages should bundle the adapter for the same reason.
    await page.route(`**${ADAPTER_URL}`, (route) =>
      route.fulfill({ contentType: "application/javascript", body: ADAPTER_JS }));

    // Any page on the app origin will do as the host document; the public landing needs no auth.
    await page.goto("/");

    await page.evaluate(({ sandbox, src }) => {
      const scope = window as unknown as Record<string, unknown>;
      const captured: CapturedMessage[] = [];
      scope.__captured = captured;

      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", sandbox);
      frame.setAttribute("title", "bridge fixture");
      frame.src = src;
      document.body.appendChild(frame);
      scope.__frame = frame;

      window.addEventListener("message", (event) => {
        captured.push({
          data: event.data,
          // The identity check the host relies on, exercised across real documents.
          fromFrame: event.source === frame.contentWindow,
          origin: event.origin,
        });
      });
    }, { sandbox: RUNTIME_FRAME_SANDBOX, src: FIXTURE_URL });

    const captured = () => page.evaluate(
      () => (window as unknown as { __captured: CapturedMessage[] }).__captured,
    );

    // 1. The package opens with the one unauthenticated message it is allowed to send.
    await expect.poll(async () => (await captured()).length, { timeout: 20_000 }).toBeGreaterThan(0);
    const hello = (await captured())[0];
    expect(isRuntimeHandshakeRequest(hello.data)).toBe(true);
    expect(hello.fromFrame).toBe(true);
    // The sandbox is doing its job: an opaque origin cannot be named, which is the whole reason
    // the bridge posts with "*" and authenticates some other way.
    expect(hello.origin).toBe("null");

    // 2. The host answers with the real init message.
    await page.evaluate((message) => {
      const frame = (window as unknown as { __frame: HTMLIFrameElement }).__frame;
      frame.contentWindow?.postMessage(message, "*");
    }, buildRuntimeInitMessage(launch));

    // 3. The package should now produce ready, its buffered pre-init commit, and the completion.
    await expect.poll(async () => {
      const messages = await captured();
      return messages
        .map((message) => parseRuntimeBridgeMessage(message.data, launch.launchNonce)?.type)
        .filter(Boolean).length;
    }, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);

    const messages = await captured();
    expect(messages.every((message) => message.fromFrame)).toBe(true);

    const parsed = messages
      .map((message) => parseRuntimeBridgeMessage(message.data, launch.launchNonce))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    expect(parsed.map((entry) => entry.type)).toContain("ready");

    const commits = parsed.filter((entry) => entry.type === "commit");
    // The commit made before init existed must survive, carrying the nonce it could not have
    // known at the time. That is the buffering contract, proven end to end.
    expect(commits.map((entry) => entry.payload.progress)).toContain(0.25);
    // And the terminal completion must not be lost behind it.
    expect(commits.some((entry) => entry.payload.completionStatus === "completed")).toBe(true);

    // 4. The package received the session details, not just a nonce.
    await expect(page.frameLocator("iframe[title='bridge fixture']").locator("#state"))
      .toHaveText(`ready:${launch.sessionId}`);
  });
});
