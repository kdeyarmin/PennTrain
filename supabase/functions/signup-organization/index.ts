import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createSignupOrganizationHandler } from "./handler.ts";

Deno.serve(createSignupOrganizationHandler({ createClient }));
