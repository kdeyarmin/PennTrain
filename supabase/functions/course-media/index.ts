import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createNativeCourseMediaHandler } from "./handler.ts";
Deno.serve(createNativeCourseMediaHandler({ createClient }));
