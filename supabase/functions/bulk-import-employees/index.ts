import { createClient } from "jsr:@supabase/supabase-js@2";
import { parse } from "jsr:@std/csv/parse";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// job_title has no default in the employees table -- required. hire_date/email/etc are nullable
// with defaults, so left optional.
const REQUIRED_COLUMNS = ["first_name", "last_name", "job_title", "facility_id"];

interface ImportRowResult {
  row: number;
  success: boolean;
  error?: string;
  employee_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // This function operates entirely AS THE CALLING USER -- no service-role elevation. employees
  // table RLS (org_admin/facility_manager/trainer, scoped to assigned facilities) already correctly
  // gates who may insert employees and into which facility; there is no privilege-escalation need
  // here, only CSV-parsing/batch-reporting convenience that a plain client-side loop would also be
  // capable of, just less conveniently.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, organization_id, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json({ error: "Caller profile not found or inactive" }, 403);
  }
  if (!["platform_admin", "org_admin", "facility_manager", "trainer"].includes(callerProfile.role as string)) {
    return json({ error: "not authorized to import employees" }, 403);
  }

  let body: { csv?: string; organization_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { csv, organization_id } = body;
  if (!csv || typeof csv !== "string") return json({ error: "csv (string) is required" }, 400);

  const effectiveOrgId = callerProfile.role === "platform_admin" ? organization_id : callerProfile.organization_id;
  if (!effectiveOrgId) return json({ error: "organization_id is required" }, 400);

  let rows: Record<string, string | undefined>[];
  try {
    rows = (await parse(csv, { skipFirstRow: true, strip: true })) as Record<string, string | undefined>[];
  } catch (e) {
    return json({ error: `Failed to parse CSV: ${(e as Error).message}` }, 400);
  }

  if (rows.length === 0) return json({ error: "CSV contains no data rows" }, 400);
  if (rows.length > 1000) return json({ error: "CSV exceeds the 1000-row import limit; split into smaller files" }, 400);

  const missingCols = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]));
  if (missingCols.length > 0) {
    return json({ error: `CSV is missing required columns: ${missingCols.join(", ")}` }, 400);
  }

  const results: ImportRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header row already stripped
    const first_name = row.first_name?.trim();
    const last_name = row.last_name?.trim();
    const job_title = row.job_title?.trim();
    const facility_id = row.facility_id?.trim();

    if (!first_name || !last_name || !job_title || !facility_id) {
      results.push({ row: rowNumber, success: false, error: "missing required field(s): first_name, last_name, job_title, facility_id" });
      continue;
    }

    const { data, error } = await callerClient
      .from("employees")
      .insert({
        organization_id: effectiveOrgId,
        facility_id,
        first_name,
        last_name,
        job_title,
        email: row.email?.trim() || null,
        employee_number: row.employee_number?.trim() || null,
        department: row.department?.trim() || null,
        phone: row.phone?.trim() || null,
        hire_date: row.hire_date?.trim() || null,
        status: row.status?.trim() || "active",
        trainer_status: row.trainer_status?.trim().toLowerCase() === "true",
        administers_medications: row.administers_medications?.trim().toLowerCase() === "true",
      })
      .select("id")
      .single();

    if (error) {
      results.push({ row: rowNumber, success: false, error: error.message });
    } else {
      results.push({ row: rowNumber, success: true, employee_id: data.id });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return json({ success: true, total: results.length, succeeded, failed, results });
});
