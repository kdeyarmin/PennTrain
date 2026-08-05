/**
 * Emergency elevated access, granted and ended (BACKLOG.md G15.9, G15.10).
 *
 * `grant_identity_break_glass` takes a target, a requester, a written reason, a ticket reference
 * and a mandatory expiry -- every field somebody designed because break-glass is the access you
 * have to justify afterwards. `revoke_identity_break_glass` ends one early. Neither had a caller,
 * so the mechanism existed in full and emergency access could not be granted at all, which also
 * means it could not be ended.
 *
 * The half that matters most is the second one. An emergency grant that cannot be revoked early
 * runs until its expiry no matter what the investigation finds.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface BreakGlassEvent {
  id: string;
  target_profile_id: string;
  requested_by: string | null;
  approved_by: string | null;
  reason: string;
  ticket_reference: string | null;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
}

export function useBreakGlassEvents() {
  return useQuery({
    queryKey: ["break-glass-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("identity_break_glass_events")
        .select("id,target_profile_id,requested_by,approved_by,reason,ticket_reference,granted_at,expires_at,revoked_at,revocation_reason")
        .order("granted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as BreakGlassEvent[];
    },
  });
}

/** Live now: granted, not revoked, not yet expired. The set that actually carries privilege. */
export function isBreakGlassActive(event: BreakGlassEvent, now = new Date()): boolean {
  if (event.revoked_at) return false;
  return new Date(event.expires_at).getTime() > now.getTime();
}

function useBreakGlassMutation<TArgs, TResult>(run: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["break-glass-events"] }),
  });
}

export function useGrantBreakGlass() {
  return useBreakGlassMutation(async (input: {
    targetProfileId: string;
    requestedBy: string;
    reason: string;
    ticketReference: string;
    expiresAt: string;
  }) => {
    const { data, error } = await supabase.rpc("grant_identity_break_glass" as never, {
      p_target_profile_id: input.targetProfileId,
      p_requested_by: input.requestedBy,
      p_reason: input.reason,
      p_ticket_reference: input.ticketReference,
      p_expires_at: input.expiresAt,
    } as never);
    if (error) throw error;
    return data as unknown;
  });
}

export function useRevokeBreakGlass() {
  return useBreakGlassMutation(async (input: { eventId: string; reason: string }) => {
    const { error } = await supabase.rpc("revoke_identity_break_glass" as never, {
      p_event_id: input.eventId,
      p_reason: input.reason,
    } as never);
    if (error) throw error;
    return true;
  });
}
