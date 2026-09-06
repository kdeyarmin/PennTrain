// Forwarding the TRUSTED caller address to the database's guest throttle.
//
// `app_private.guest_caller_key` (20260905230000:81-105, still the key source for
// `public.guest_request_denial` at 20260905360000:85) builds the throttle key from
//
//     split_part(request.headers ->> 'x-forwarded-for', ',', 1)
//
// -- the FIRST hop. x-forwarded-for is append-only: every proxy APPENDS the peer address it
// accepted the connection from to the right of the list and never rewrites what was already
// there, so the first hop is whatever the client sent. That is the same mistake G32 fixed in the
// edge functions, and `_shared/clientIp.ts:3-10` is the standing statement of it in this
// repository: only the LAST hop is an address a gateway itself observed, and a caller who rotates
// the header defeats the 60/min and 10-unknown-token rules outright while attributing every
// `guest_token_failures` row to an address that never existed.
//
// HOW MANY HOPS DOES THE PLATFORM APPEND? The index is never assumed here. `clientIp()` takes the
// last NON-EMPTY hop whatever the length of the chain -- that is the contract asserted in
// `_shared/clientIp.test.ts:11-23` ("6.6.6.6, 203.0.113.9" -> 203.0.113.9, a single hop
// "203.0.113.9" -> 203.0.113.9, and trailing empty segments tolerated) -- and under `CF_FRONTED`
// it prefers `cf-connecting-ip`, which is meaningful only when Cloudflare verifiably fronts the
// deployment. Nothing here counts hops, so nothing here breaks when the platform adds one.
//
// WHY THIS HELPER RATHER THAN A CHANGE IN SQL. The gate reads whatever x-forwarded-for PostgREST
// received. An edge function is a NEW client of PostgREST: without this header it sends none at
// all, the platform appends the function's own egress address, and `guest_caller_key` returns THAT
// -- so every guest download in the world, from every building, shared one 60-requests-a-minute
// budget and one pool of ten unknown-token strikes. Sending a single-hop x-forwarded-for holding
// the address the function itself derived from its own request makes the gate's first-hop read
// land on the trusted value, per guest, with no migration.
//
// Callers whose guest RPC is invoked straight from the browser (the guest pages) are NOT covered
// by this: their first hop is still whatever that browser sent, and fixing those needs
// `guest_caller_key` itself to read the last hop.
import { clientIp } from "./clientIp.ts";

/**
 * Headers to attach to the Supabase client that will call a guest RPC
 * (`guest_request_denial` and everything that runs it first).
 *
 * A single hop on purpose: the value is the one address this function trusts, and passing the
 * incoming chain through verbatim would hand the caller's own forged prefix straight to the gate.
 * When no trusted address can be derived at all, no header is sent -- `guest_caller_key` then
 * falls back to keying on the token digest, which is its own documented behaviour and better than
 * asserting an address that is not one.
 */
export function guestCallerForwardHeaders(req: Request): Record<string, string> {
  const ip = clientIp(req);
  if (ip === "unknown") return {};
  return { "x-forwarded-for": ip };
}
