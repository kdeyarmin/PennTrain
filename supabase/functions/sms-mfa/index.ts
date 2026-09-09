import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createSmsMfaHandler } from "./handler.ts";

Deno.serve(createSmsMfaHandler({ createClient }));
