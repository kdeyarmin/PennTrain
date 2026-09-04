import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createProcessOrganizationExportJobsHandler } from "./handler.ts";

Deno.serve(createProcessOrganizationExportJobsHandler({ createClient }));
