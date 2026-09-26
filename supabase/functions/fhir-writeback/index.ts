import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createFhirWritebackHandler } from "./handler.ts";

Deno.serve(createFhirWritebackHandler({ createClient }));
