import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createPackageAssetHandler, type PackageAssetContext } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const handler = createPackageAssetHandler({
  async loadContext(sessionId) {
    const { data: session, error } = await admin.from("learning_runtime_sessions").select("*").eq("id", sessionId).maybeSingle();
    if (error || !session) return null;
    const [p, a, e, o] = await Promise.all([
      admin.from("learning_packages").select("*").eq("id", session.package_id).maybeSingle(),
      admin.from("course_assignments").select("*").eq("id", session.assignment_id).maybeSingle(),
      admin.from("employees").select("id, organization_id, profile_id, status").eq("id", session.employee_id).maybeSingle(),
      admin.from("organizations").select("id, subscription_status").eq("id", session.organization_id).maybeSingle(),
    ]);
    if (p.error || a.error || e.error || o.error || !p.data || !a.data || !o.data || !e.data?.profile_id) return null;
    const { data: profile, error: profileError } = await admin.from("profiles").select("id, organization_id, is_active, role").eq("id", e.data.profile_id).maybeSingle();
    if (profileError || !profile) return null;
    return { session, pkg: p.data, assignment: a.data, employee: e.data, profile, organization: o.data } as PackageAssetContext;
  },
  async downloadArchive(bucket, path) {
    const { data, error } = await admin.storage.from(bucket).download(path);
    return error ? null : data;
  },
});
Deno.serve(handler);
