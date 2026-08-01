/*
 * CareBase learning runtime bridge -- reference adapter for SCORM/xAPI package authors.
 *
 * Bundled into accepted packages by bundle-learning-package-adapter (B1).
 * Protocol: hello/init/ready/commit/xapi/error via postMessage with nonce + event.source.
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
    if (event.source !== window.parent) return;
    var data = event && event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== HOST_SOURCE || data.type !== "init") return;
    if (typeof data.nonce !== "string" || !data.nonce) return;

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
  window.parent.postMessage({ source: PACKAGE_SOURCE, type: "hello" }, "*");

  window.CareBaseLearningRuntime = {
    onReady: function (callback) {
      if (typeof callback !== "function") return;
      if (session && announced) {
        callback(session);
        return;
      }
      readyCallbacks.push(callback);
    },
    commit: function (state) {
      send("commit", state || {});
    },
    complete: function (state) {
      var payload = state || {};
      payload.progress = 1;
      payload.completionStatus = "completed";
      send("commit", payload);
    },
    xapi: function (statement) {
      send("xapi", statement || {});
    },
    error: function (message) {
      send("error", { message: String(message) });
    },
    getSession: function () {
      return session;
    },
  };
})();
