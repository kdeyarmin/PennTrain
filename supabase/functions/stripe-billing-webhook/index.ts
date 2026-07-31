import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createStripeBillingWebhookHandler } from "./handler.ts";

Deno.serve(createStripeBillingWebhookHandler({
  createClient: createClient as never,
}));
