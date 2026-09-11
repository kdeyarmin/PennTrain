import { phase2StripeGet, phase2StripePost } from "./phase2Billing.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION = /^cs_(?:test|live)_[A-Za-z0-9]+$/;
const keys = (value: unknown, names: string[]): value is Record<string, unknown> => value !== null && typeof value === "object"
  && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
export class CheckoutReservationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 503) { super(code); this.code = code; this.status = status; }
}
export function checkoutRpc(result: {data?: unknown; error?: {code?: string} | null}): unknown {
  if (!result.error) return result.data;
  const code = result.error.code;
  throw new CheckoutReservationError(code === "42501" ? "forbidden" : code === "40001" ? "checkout_conflict"
    : code === "P0002" ? "notfound" : "billing_state_unavailable", code === "42501" ? 403 : code === "40001" ? 409 : code === "P0002" ? 404 : 503);
}
export function checkoutMode(secretKey: string): boolean {
  const match = /^(?:sk|rk)_(test|live)_/.exec(secretKey);
  if (!match) throw new CheckoutReservationError("billing_not_configured");
  return match[1] === "live";
}
export function checkoutUrl(value: unknown, id: string): value is string {
  if (typeof value !== "string" || value.length > 4096 || !SESSION.test(id)
    || !value.startsWith(`https://checkout.stripe.com/c/pay/${id}`)) return false;
  const rest = value.slice(`https://checkout.stripe.com/c/pay/${id}`.length);
  // Stripe's documented hosted URL includes an opaque percent-encoded fragment.
  // Match the raw authority/path; never accept alternate hosts, ports or queries.
  return rest === "" || /^#[A-Za-z0-9%._~!$&()*+,;=:/?@-]+$/.test(rest) && !/%(?![0-9a-f]{2})/i.test(rest);
}
type CheckoutSession = {kind: "checkout"; id: string; url: string | null; expiresAt: string; livemode: boolean;
  customerId: string | null; subscriptionId: string | null; status: "open" | "complete" | "expired"};
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const providerId = (v: unknown): string | null => typeof v === "string" ? v : typeof object(v).id === "string" ? object(v).id as string : null;

function providerSession(data: Record<string, unknown>, values: Record<string, unknown>, live: boolean, priorId: string | null,
  priceConfiguration: Record<string, unknown> | null): CheckoutSession {
  const id = data.id, customer = providerId(data.customer), subscription = providerId(data.subscription);
  if (typeof id !== "string" || !SESSION.test(id) || (priorId !== null && id !== priorId)
    || data.livemode !== live || id.startsWith("cs_live_") !== live || data.mode !== "subscription"
    || data.client_reference_id !== values.client_reference_id || !["open", "complete", "expired"].includes(data.status as string)
    || !Number.isSafeInteger(data.expires_at) || Number(data.expires_at) <= 0
    || (values.customer != null && customer !== values.customer) || (customer !== null && !/^cus_[A-Za-z0-9]+$/.test(customer))
    || (subscription !== null && !/^sub_[A-Za-z0-9]+$/.test(subscription))) throw new CheckoutReservationError("invalid_stripe_response");
  for (const [name, expected] of Object.entries(object(values.metadata))) {
    if (object(data.metadata)[name] !== expected) throw new CheckoutReservationError("invalid_stripe_response");
  }
  if (priceConfiguration !== null) {
    const lines = object(data.line_items), line = object(Array.isArray(lines.data) ? lines.data[0] : null);
    const expected = object(Array.isArray(values.line_items) ? values.line_items[0] : null);
    const price = providerId(line.price) ?? providerId(object(object(line.pricing).price_details).price);
    if (!Array.isArray(lines.data) || lines.data.length !== 1 || lines.has_more !== false
      || price !== expected.price || line.quantity !== expected.quantity
      || object(line.price).currency !== priceConfiguration.currency
      || object(object(line.price).recurring).interval !== object(values.metadata).billing_interval
      || object(object(line.price).recurring).interval_count !== priceConfiguration.interval_count) throw new CheckoutReservationError("invalid_stripe_response");
  }
  const expiresAt = new Date(Number(data.expires_at) * 1000).toISOString();
  if (data.status === "open" && !checkoutUrl(data.url, id)) throw new CheckoutReservationError("invalid_stripe_response");
  return {kind: "checkout", id, url: data.status === "open" ? data.url as string : null, expiresAt, livemode: live,
    customerId: customer, subscriptionId: subscription, status: data.status as CheckoutSession["status"]};
}

export function projectCheckoutResult(value: unknown) {
  if (!keys(value, ["commandId", "action", "targetId", "outcome", "replayed", "checkedAt", "providerStatus", "availability", "canStartNewCheckout", "retryAfterSeconds", "session"])
    || typeof value.commandId !== "string" || !UUID.test(value.commandId) || typeof value.targetId !== "string" || !UUID.test(value.targetId)
    || value.action !== "billing.checkout.create" || !["open", "complete", "expired", "pending", "failed"].includes(value.outcome as string)
    || typeof value.replayed !== "boolean" || typeof value.canStartNewCheckout !== "boolean"
    || (value.canStartNewCheckout && ["open", "pending"].includes(value.outcome as string)) || !["available", "unavailable"].includes(value.availability as string)
    || ![null, "open", "complete", "expired"].includes(value.providerStatus as null | string)
    || (value.checkedAt !== null && (typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt))))) throw new CheckoutReservationError("invalid_checkout_result");
  if (value.outcome === "pending") {
    if (value.session !== null || value.retryAfterSeconds !== 30) throw new CheckoutReservationError("invalid_checkout_result");
  } else if (value.availability !== "available" || value.checkedAt === null || value.retryAfterSeconds !== null) throw new CheckoutReservationError("invalid_checkout_result");
  if (value.outcome === "open") {
    const session = value.session;
    if (!keys(session, ["kind", "id", "url", "expiresAt", "livemode"]) || session.kind !== "checkout"
      || typeof session.id !== "string" || !checkoutUrl(session.url, session.id) || typeof session.livemode !== "boolean"
      || typeof session.expiresAt !== "string" || !Number.isFinite(Date.parse(session.expiresAt)) || value.providerStatus !== "open") throw new CheckoutReservationError("invalid_checkout_result");
  } else if (value.session !== null) throw new CheckoutReservationError("invalid_checkout_result");
  return value;
}

/** Claim is already committed. A failed GET never exposes the POST capability.
 * Both the native handler and Hub adapter execute this exact provider protocol. */
export async function executeCheckoutClaim(claim: unknown, {
  admin, secretKey, stripePost = phase2StripePost, stripeGet = phase2StripeGet,
}: {
  // Supabase's Node and Deno clients share the same public RPC interface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any; secretKey: string; stripePost?: typeof phase2StripePost; stripeGet?: typeof phase2StripeGet;
}): Promise<{commandId: string; replayed: boolean}> {
  if (keys(claim, ["kind", "data"]) && claim.kind === "result") {
    const result = projectCheckoutResult(claim.data);
    return {commandId: result.commandId as string, replayed: true};
  }
  if (!keys(claim, ["kind", "reservationId", "commandId", "targetId", "leaseId", "idempotencyKey", "values", "priorSession", "replayed", "firstDispatch", "priceConfiguration"])
    || !["create", "check"].includes(claim.kind as string) || ![claim.reservationId, claim.commandId, claim.targetId, claim.leaseId].every(v => typeof v === "string" && UUID.test(v))
    || claim.idempotencyKey !== `carebase:checkout:${claim.reservationId}` || typeof claim.replayed !== "boolean"
    || typeof claim.firstDispatch !== "boolean" || (claim.kind === "check" && claim.firstDispatch)) throw new CheckoutReservationError("invalid_checkout_claim");
  const values = object(claim.values), prior = object(claim.priorSession), live = checkoutMode(secretKey);
  if (values.mode !== "subscription" || values.client_reference_id !== claim.targetId
    || (claim.kind === "check" && (typeof prior.id !== "string" || !SESSION.test(prior.id)))
    || (claim.kind === "create" && claim.priorSession !== null)) throw new CheckoutReservationError("invalid_checkout_claim");
  let outcome = "indeterminate", session: CheckoutSession | null = null, subscriptionStatus: string | null = null;
  try {
    let id = claim.kind === "check" ? prior.id as string : null;
    if (id === null) {
      const created = await stripePost("/v1/checkout/sessions", secretKey, values as never, claim.idempotencyKey as string);
      if (!created.ok) {
        if (claim.firstDispatch && [400, 401, 403, 404, 422].includes(created.status)) outcome = "failed";
      } else {
        session = providerSession(created.data, values, live, null, null); id = session.id;
      }
    }
    if (id !== null) {
      const observed = await stripeGet(`/v1/checkout/sessions/${id}?expand%5B%5D=line_items`, secretKey);
      if (observed.ok) {
        const boundValues = {...values, customer: values.customer ?? session?.customerId ?? prior.customerId};
        session = providerSession(observed.data, boundValues, live, id, object(claim.priceConfiguration));
        if (prior.subscriptionId != null && session.subscriptionId !== prior.subscriptionId) throw new CheckoutReservationError("invalid_stripe_response");
        outcome = session.status;
        if (session.status === "complete" && session.subscriptionId && session.customerId) {
          const subscription = await stripeGet(`/v1/subscriptions/${session.subscriptionId}`, secretKey);
          if (subscription.ok && subscription.data.id === session.subscriptionId && subscription.data.livemode === live
            && providerId(subscription.data.customer) === session.customerId
            && object(subscription.data.metadata).organization_id === values.client_reference_id) {
            subscriptionStatus = typeof subscription.data.status === "string" ? subscription.data.status : null;
            if (["canceled", "incomplete_expired"].includes(subscriptionStatus ?? "")) outcome = "closed";
          }
        }
      }
    }
  } catch { /* Keep the known identifier, if any, for a GET-only retry. */ }
  checkoutRpc(await admin.rpc("finish_checkout_reservation", {p_reservation_id: claim.reservationId, p_lease_id: claim.leaseId,
    p_outcome: outcome, p_session: session, p_subscription_status: subscriptionStatus}));
  return {commandId: claim.commandId as string, replayed: claim.replayed as boolean};
}
