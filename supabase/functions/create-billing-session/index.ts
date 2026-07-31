import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { phase2StripePost } from "../_shared/phase2Billing.ts";
import { createCreateBillingSessionHandler } from "./handler.ts";

Deno.serve(createCreateBillingSessionHandler({
  createClient: createClient as never,
  stripePost: phase2StripePost as never,
}));
