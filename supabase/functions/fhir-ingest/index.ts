import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createFhirIngestHandler } from "./handler.ts";

Deno.serve(createFhirIngestHandler({ createClient }));
