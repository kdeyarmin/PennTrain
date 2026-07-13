import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set");
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Older service workers used the "supabase-runtime" cache for RLS-scoped REST responses. Current
// builds only runtime-cache public course-video storage, but keep clearing both names on auth
// transitions so upgraded clients cannot keep serving stale protected responses from the old cache.
export async function clearSupabaseRuntimeCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  await Promise.all([
    caches.delete("supabase-runtime"),
    caches.delete("supabase-public-storage"),
  ]);
}
