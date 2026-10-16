import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createResendInviteLinkHandler } from "./handler.ts";

Deno.serve(createResendInviteLinkHandler({ createClient }));
