import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createInviteUserHandler } from "./handler.ts";

Deno.serve(createInviteUserHandler({ createClient }));
