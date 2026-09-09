import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createPushSubscriptionsHandler } from "./handler.ts";

Deno.serve(createPushSubscriptionsHandler({ createClient }));
