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
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function enableWebPush(): Promise<PushSubscription> {
  if (getPushPermissionState() === "unsupported") throw new Error("Web push is not supported by this browser.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Browser notification permission was not granted.");
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const { data: keyResponse, error: keyError } = await supabase.functions.invoke("push-subscriptions", { method: "GET" });
  if (keyError || typeof keyResponse?.publicKey !== "string") throw new Error(keyError?.message || "Web push is not configured.");
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(keyResponse.publicKey),
  });
  const { error } = await supabase.functions.invoke("push-subscriptions", {
    method: "POST",
    body: { subscription: subscription.toJSON() },
  });
  if (error) {
    if (!existing) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
  return subscription;
}

export async function disableWebPush(): Promise<void> {
  if (getPushPermissionState() === "unsupported") return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const { error } = await supabase.functions.invoke("push-subscriptions", {
    method: "DELETE",
    body: { endpoint: subscription.endpoint },
  });
  if (error) throw error;
  await subscription.unsubscribe();
}

export async function hasActiveWebPushSubscription(): Promise<boolean> {
  if (getPushPermissionState() === "unsupported" || Notification.permission !== "granted") return false;
  return Boolean(await (await navigator.serviceWorker.ready).pushManager.getSubscription());
}
