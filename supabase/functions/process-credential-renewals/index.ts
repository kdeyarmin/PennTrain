import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createProcessCredentialRenewalsHandler } from "./handler.ts";

Deno.serve(createProcessCredentialRenewalsHandler({ createClient }));
