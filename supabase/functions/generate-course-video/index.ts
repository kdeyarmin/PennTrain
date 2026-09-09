import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createGenerateCourseVideoHandler } from "./handler.ts";

Deno.serve(createGenerateCourseVideoHandler({ createClient }));
