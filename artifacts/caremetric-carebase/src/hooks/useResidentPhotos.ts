import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

const PHOTO_KEY = "clinical-chart-resident-photos";
/** Comfortably longer than a caregiver spends picking a resident, shorter than a shift. */
const SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Signed photo URLs keyed by resident id, for right-patient verification on the caregiver surface.
 *
 * Batched deliberately: the roster and the chart header share one query key, so opening a resident
 * after scrolling the list costs nothing, and a facility's photos are signed in a single storage
 * round trip rather than one per row. Reading a photo is a logged PHI access like any other resident
 * document -- the gate is the storage policy in 20260803120000, not this hook.
 *
 * The key carries organization and role as well as the profile id, and it has to. A signed URL is
 * bearer-authorized for its whole TTL: once minted it keeps resolving regardless of what RLS would
 * say now. So an admin moving this employee to another facility or changing their role mid-shift --
 * a transition auth.tsx explicitly handles by wiping the offline draft store, but which does *not*
 * clear the query cache -- would otherwise leave the previous facility's resident photos both cached
 * under an unchanged profile id and still resolvable. Re-keying forces a fresh sign under the new
 * context instead.
 */
export function useResidentPhotoUrls() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [PHOTO_KEY, user?.id, user?.organizationId, user?.role],
    enabled: Boolean(user?.id && user?.organizationId),
    // staleTime alone only marks data stale -- nothing re-runs, and refetchOnWindowFocus is off
    // globally (lib/queryClient.ts). A roster left open for a shift would then hand an expired URL to
    // any <img> that remounts. refetchInterval is what actually keeps them live.
    staleTime: (SIGNED_URL_TTL_SECONDS - 60) * 1000,
    refetchInterval: (SIGNED_URL_TTL_SECONDS - 60) * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.rpc("get_clinical_chart_resident_photos");
      if (error) throw error;
      const rows = (data ?? []) as unknown as {
        resident_id: string; storage_bucket: string; storage_path: string;
      }[];
      if (rows.length === 0) return {};

      // One bucket in practice, but grouped rather than assumed -- storage_bucket is a real column
      // and signing across buckets in one call is not possible.
      const byBucket = new Map<string, typeof rows>();
      for (const row of rows) {
        const list = byBucket.get(row.storage_bucket) ?? [];
        list.push(row);
        byBucket.set(row.storage_bucket, list);
      }

      const urls: Record<string, string> = {};
      for (const [bucket, bucketRows] of byBucket) {
        const { data: signed, error: signError } = await supabase.storage
          .from(bucket)
          .createSignedUrls(bucketRows.map((row) => row.storage_path), SIGNED_URL_TTL_SECONDS);
        // A photo that will not sign is not worth failing a roster over -- the avatar falls back to
        // initials, which is what it does when a resident simply has no photo on file.
        if (signError) continue;
        for (const entry of signed ?? []) {
          if (!entry.signedUrl || entry.error) continue;
          const match = bucketRows.find((row) => entry.path === row.storage_path);
          if (match) urls[match.resident_id] = entry.signedUrl;
        }
      }
      return urls;
    },
  });
}
