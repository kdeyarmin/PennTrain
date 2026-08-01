/** Embedded source of the CareBase learning-runtime bridge adapter (learning-runtime-bridge.js).
 * Keep this in sync with public/learning-runtime-bridge.js -- it is the verbatim file bundled
 * into SCORM/xAPI packages by the accept-learning-package edge function.
 */
export const LEARNING_RUNTIME_BRIDGE_SOURCE: string = `/*
 * CareBase learning runtime bridge -- reference adapter for SCORM/xAPI package authors.
 *
 * Include this in a package and talk to the host through window.CareBaseLearningRuntime instead of
 * hand-rolling postMessage:
 *
 *   <script src="https://<your-carebase-host>/learning-runtime-bridge.js"></script>
 *   <script>
 *     CareBaseLearningRuntime.onReady(function (session) {
 *       // session: { nonce, sessionId, registrationKey, standard, entryPoint, expiresAt }
 *     });
 *     CareBaseLearningRuntime.commit({ progress: 0.5, completionStatus: "incomplete" });
 *     CareBaseLearningRuntime.complete({ successStatus: "passed" });
 *   </script>
 *
 * Protocol, for anyone implementing this directly:
 *
 *   package -> host   { source: "carebase-learning-runtime", type: "hello" }
 *   host -> package   { source: "carebase-learning-runtime-host", type: "init",
 *                       nonce, payload: { sessionId, registrationKey, standard, entryPoint, expiresAt } }
 *   package -> host   { source: "carebase-learning-runtime", type, nonce, payload }
 *                       type: "ready" | "commit" | "xapi" | "error"
 *
 * \`hello\` is the only message that carries no nonce, because the package cannot know the nonce
 * until the host sends it. The host answers it only for the frame it created (it checks
 * event.source), and pushes an init unprompted when the frame loads -- so a package that registers
 * its listener before load never needs to ask. Every later message must echo the nonce or the host
 * drops it.
 *
 * The frame is sandboxed without allow-same-origin, so its origin is opaque: it cannot read the
 * host page, and the host cannot name its origin when posting. That is why targetOrigin is "*" on
 * both sides, and why identity is established by nonce and event.source rather than by origin.
 */
(function () {
  "use strict";

  var PACKAGE_SOURCE = "carebase-learning-runtime";
  var HOST_SOURCE = "carebase-learning-runtime-host";

  var session = null;
  var pending = [];
  var readyCallbacks = [];
  var announced = false;

  function send(type, payload) {
    var message = { source: PACKAGE_SOURCE, type: type, payload: payload || {} };
    if (!session) {
      // Buffer until the host hands over a nonce. Content that reports progress immediately on
      // load would otherwise lose those commits: without a nonce the host drops them silently.
      pending.push(message);
      return;
    }
    message.nonce = session.nonce;
    window.parent.postMessage(message, "*");
  }

  function flush() {
    var queued = pending;
    pending = [];
    for (var i = 0; i < queued.length; i += 1) {
      queued[i].nonce = session.nonce;
      window.parent.postMessage(queued[i], "*");
    }
  }

  function onHostMessage(event) {
    // Only the host frame may open or re-key a session. The envelope alone is not proof of
    // anything: it is public, so any window able to reach this one -- a third-party frame the
    // package embeds, a popup it opened -- could otherwise forge an init, replace the nonce, and
    // make every real message fail the host's check. The host applies the mirror image of this
    // rule to inbound messages, and the whole model depends on both halves enforcing it.
    if (event.source !== window.parent) return;

    var data = event && event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== HOST_SOURCE || data.type !== "init") return;
    if (typeof data.nonce !== "string" || !data.nonce) return;

    // Always take the newest nonce. A relaunch issues a fresh one, and messages signed with the
    // previous nonce are rejected.
    var payload = data.payload && typeof data.payload === "object" ? data.payload : {};
    session = {
      nonce: data.nonce,
      sessionId: payload.sessionId,
      registrationKey: payload.registrationKey,
      standard: payload.standard,
      entryPoint: payload.entryPoint,
      expiresAt: payload.expiresAt,
    };

    flush();

    if (!announced) {
      announced = true;
      send("ready", {});
      for (var i = 0; i < readyCallbacks.length; i += 1) {
        try {
          readyCallbacks[i](session);
        } catch (err) {
          send("error", { message: String((err && err.message) || err) });
        }
      }
      readyCallbacks = [];
    }
  }

  window.addEventListener("message", onHostMessage);

  // Covers the case where the host's load-time push happened before this script ran.
  window.parent.postMessage({ source: PACKAGE_SOURCE, type: "hello" }, "*");

  window.CareBaseLearningRuntime = {
    /** Run once the host has handed over the session, immediately if that already happened. */
    onReady: function (callback) {
      if (typeof callback !== "function") return;
      if (session && announced) {
        callback(session);
        return;
      }
      readyCallbacks.push(callback);
    },
    /** Save progress. Accepts the SCORM-ish fields normalizeRuntimeCommitState understands. */
    commit: function (state) {
      send("commit", state || {});
    },
    /** Save a terminal completion. */
    complete: function (state) {
      var payload = state || {};
      payload.progress = 1;
      payload.completionStatus = "completed";
      send("commit", payload);
    },
    /** Send an xAPI statement ({ id, verb, object, result, context }). */
    xapi: function (statement) {
      send("xapi", statement || {});
    },
    /** Report a package-side failure to the host UI. */
    error: function (message) {
      send("error", { message: String(message) });
    },
    /** The active session, or null before the host has answered. */
    getSession: function () {
      return session;
    },
  };
})();
`;
