import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createCaptureProductEventHandler } from "./handler.ts";

Deno.serve(createCaptureProductEventHandler({ createClient }));
