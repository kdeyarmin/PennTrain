import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createGenerateFireDrillTrackerPdfHandler } from "./handler.ts";

Deno.serve(createGenerateFireDrillTrackerPdfHandler({ createClient: createClient as any }));
