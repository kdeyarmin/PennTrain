import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { phase2StripeGet, phase2StripePost } from "../_shared/phase2Billing.ts";
import { createSyncBillingQuantitiesHandler } from "./handler.ts";
import { createBillingRuntimeHandler } from "./forwarding.ts";

Deno.serve(createBillingRuntimeHandler({
  supabaseHandler: createSyncBillingQuantitiesHandler({
    createClient: createClient as never,
    stripePost: phase2StripePost as never,
    stripeGet: phase2StripeGet as never,
  }),
}));
