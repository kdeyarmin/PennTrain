import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function sessionId() {
  const key = "caremetric-product-session";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}

export function ProductTelemetry() {
  const [location] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    if (!user || !/^\/(app|admin|me|trainer|account)(\/|$)/.test(location)) return;
    const timer = window.setTimeout(() => {
      void supabase.functions.invoke("capture-product-event", {
        body: {
          eventName: "route_viewed",
          route: location,
          sessionId: sessionId(),
          occurredAt: new Date().toISOString(),
          properties: {
            deviceClass: window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop",
            offline: !navigator.onLine,
          },
        },
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [location, user]);

  return null;
}
