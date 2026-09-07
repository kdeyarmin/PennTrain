import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createAdminUpdateUserHandler } from "./handler.ts";

Deno.serve(createAdminUpdateUserHandler({ createClient }));
