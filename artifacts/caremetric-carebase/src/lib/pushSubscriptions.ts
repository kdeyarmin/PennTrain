import { supabase } from "@/lib/supabase";

export type PushPermissionState = NotificationPermission | "unsupported";

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export function getPushPermissionState(): PushPermissionState {
  if (typeof navigator === "undefined" || typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

async function activeRegistration(signal?: AbortSignal): Promise<ServiceWorkerRegistration> {
  // ready never rejects and can wait forever when the PWA worker is not installed (including
  // the normal development server). Avoid leaving the notification toggle permanently busy.
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.getRegistration().then(registration => {
        signal?.throwIfAborted();
        if (!registration) throw new Error("Browser notifications are not ready. Reload the installed app and try again.");
        return registration.active ? registration : navigator.serviceWorker.ready;
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Browser notifications did not become ready. Reload the app and try again.")), 10_000);
        abort = () => reject(signal?.reason ?? new DOMException("Push setup canceled", "AbortError"));
        signal?.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export async function enableWebPush(signal?: AbortSignal): Promise<PushSubscription> {
  signal?.throwIfAborted();
  if (getPushPermissionState() === "unsupported") throw new Error("Web push is not supported by this browser.");
  const permission = await Notification.requestPermission();
  signal?.throwIfAborted();
  if (permission !== "granted") throw new Error("Browser notification permission was not granted.");
  const registration = await activeRegistration(signal);
  const existing = await registration.pushManager.getSubscription();
  signal?.throwIfAborted();
  const { data: keyResponse, error: keyError } = await supabase.functions.invoke("push-subscriptions", { method: "GET", signal });
  if (keyError || typeof keyResponse?.publicKey !== "string") throw new Error(keyError?.message || "Web push is not configured.");
  signal?.throwIfAborted();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(keyResponse.publicKey),
  });
  try {
    signal?.throwIfAborted();
    const { error } = await supabase.functions.invoke("push-subscriptions", {
      method: "POST", signal,
      body: { subscription: subscription.toJSON() },
    });
    if (error) throw error;
  } catch (error) {
    // The browser endpoint is shared across accounts. A newer Enable can already have reused
    // it after this operation was canceled, so only undo ordinary registration failures.
    if (!existing && !signal?.aborted) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
  return subscription;
}

export async function disableWebPush(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (getPushPermissionState() === "unsupported") return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  signal?.throwIfAborted();
  const { error } = await supabase.functions.invoke("push-subscriptions", {
    method: "DELETE", signal,
    body: { endpoint: subscription.endpoint },
  });
  if (error) throw error;
  signal?.throwIfAborted();
  await subscription.unsubscribe();
}

export async function hasActiveWebPushSubscription(signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  if (getPushPermissionState() === "unsupported" || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  signal?.throwIfAborted();
  const { data, error } = await supabase.functions.invoke("push-subscriptions", {
    method: "POST", signal, body: { action: "status", endpoint: subscription.endpoint },
  });
  if (error) throw error;
  return data?.active === true;
}
