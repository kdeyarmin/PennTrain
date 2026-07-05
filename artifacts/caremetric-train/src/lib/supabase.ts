import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set");
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// The PWA service worker (vite.config.ts) runtime-caches Supabase REST/storage GETs by URL only --
// Workbox's default cache key ignores the Authorization header that RLS depends on, so two
// different users/orgs hitting the same endpoint (e.g. `/rest/v1/employees?select=*`) share one
// cache entry. Without this, logging out on a shared device (the kiosk flow explicitly supports
// shared devices) would let the next user's session fall back to the previous user's cached,
// RLS-scoped response whenever the network is slow or offline. Call this on every sign-out.
export async function clearSupabaseRuntimeCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete("supabase-runtime");
}
