import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SubscribeUpdatesPayload {
  email: string;
  name?: string;
  organization?: string;
  topics?: string[];
  sourcePath?: string;
  turnstileToken: string;
}

interface SubscribeResponse {
  ok?: boolean;
  alreadySubscribed?: boolean;
  error?: string;
}

/**
 * Public, unauthenticated newsletter/regulatory-update signup. Posts to the subscribe-updates Edge
 * Function, which owns Turnstile verification, the hashed-IP submission cap, and the service-role
 * upsert (newsletter_subscribers has no anon write policy). This is the email-capture path for
 * marketing drips.
 */
export function useSubscribeUpdates() {
  return useMutation({
    mutationFn: async (payload: SubscribeUpdatesPayload) => {
      const { data, error } = await supabase.functions.invoke<SubscribeResponse>("subscribe-updates", {
        body: {
          email: payload.email,
          name: payload.name || undefined,
          organization: payload.organization || undefined,
          topics: payload.topics && payload.topics.length > 0 ? payload.topics : undefined,
          source_path: payload.sourcePath,
          turnstile_token: payload.turnstileToken,
        },
      });
      if (error) throw error;
      if (data && data.ok === false) {
        throw new Error(data.error ?? "Subscription failed");
      }
      return (data ?? {}) as SubscribeResponse;
    },
  });
}
