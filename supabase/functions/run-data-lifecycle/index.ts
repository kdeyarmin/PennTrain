import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createRunDataLifecycleHandler } from "./handler.ts";

Deno.serve(createRunDataLifecycleHandler({ createClient }));
