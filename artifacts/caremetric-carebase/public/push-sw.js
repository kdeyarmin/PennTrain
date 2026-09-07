/* global self, clients */
"use strict";

// The landing path comes from the payload, which dispatch-notifications builds with
// _shared/webPush.ts webPushTargetPath -- the notification's own `link`, or the recipient role's
// home. This file's own fallback is only reached when a push arrives with no usable data at all,
// and it used to be "/me", the employee self-service shell, for every role
// (RELEASE_READINESS_PLAN 4.3, platform L8). "/" lets the app's post-sign-in router decide instead
// of sending an administrator to a route their role cannot render.
const FALLBACK_PATH = "/";

function safeNotificationPayload(event) {
  try {
    const value = event.data ? event.data.json() : {};
    const requestedUrl = typeof value?.data?.url === "string" ? value.data.url : FALLBACK_PATH;
    const target = new URL(requestedUrl, self.location.origin);
    return {
      title: typeof value.title === "string" ? value.title.slice(0, 160) : "CareMetric CareBase",
      options: {
        body: typeof value.body === "string" ? value.body.slice(0, 500) : "You have a new notification.",
        icon: "/pwa-192x192.png",
        badge: "/pwa-192x192.png",
        tag: typeof value?.data?.notificationId === "string" ? `notification-${value.data.notificationId}` : undefined,
        renotify: false,
        data: { url: target.origin === self.location.origin ? `${target.pathname}${target.search}${target.hash}` : FALLBACK_PATH },
      },
    };
  } catch {
    return { title: "CareMetric CareBase", options: { body: "You have a new notification.", data: { url: FALLBACK_PATH } } };
  }
}

self.addEventListener("push", (event) => {
  const payload = safeNotificationPayload(event);
  event.waitUntil(self.registration.showNotification(payload.title, payload.options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification?.data?.url || FALLBACK_PATH, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      if ("navigate" in existing) await existing.navigate(url);
      return;
    }
    await clients.openWindow(url);
  })());
});
