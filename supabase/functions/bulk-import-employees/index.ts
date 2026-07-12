// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
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
// with defaults, so left optional. A facility column is also required, but it may arrive as either
// facility_name (the documented, primary path -- resolved case-insensitively against this org's
// facilities below, since a raw facility_id UUID is never shown anywhere else in the UI) or
// facility_id (a raw UUID, still accepted for already-integrated callers) -- checked separately
// below rather than listed here, since exactly one of the two is required, not both.
const REQUIRED_COLUMNS = ["first_name", "last_name", "job_title"];

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
  const callerClient = createClient<any>(supabaseUrl, anonKey, {
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
  if (!("facility_name" in rows[0]) && !("facility_id" in rows[0])) {
    return json({ error: "CSV is missing required columns: facility_name (or facility_id)" }, 400);
  }

  // Resolved once up front rather than per-row. Queried as the caller (not a service-role client),
  // same as the rest of this function -- facilities_select RLS already allows any authenticated
  // member of an org (plus platform_admin, for any org) to read that org's own facilities, so this
  // is exactly as safe as the employees insert below and needs no elevation. Scoping to
  // effectiveOrgId server-side (rather than trusting a client-supplied id/name map) means a
  // resolved facility_id can never point outside the org this import is writing into.
  const { data: orgFacilities, error: facilitiesError } = await callerClient
    .from("facilities")
    .select("id, name")
    .eq("organization_id", effectiveOrgId);
  if (facilitiesError) return json({ error: `Failed to load facilities: ${facilitiesError.message}` }, 500);
  const facilityIdByName = new Map((orgFacilities ?? []).map((f) => [f.name.trim().toLowerCase(), f.id as string]));

  const results: ImportRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header row already stripped
    const first_name = row.first_name?.trim();
    const last_name = row.last_name?.trim();
    const job_title = row.job_title?.trim();
    const rawFacilityId = row.facility_id?.trim();
    const rawFacilityName = row.facility_name?.trim();

    if (!first_name || !last_name || !job_title || (!rawFacilityId && !rawFacilityName)) {
      results.push({ row: rowNumber, success: false, error: "missing required field(s): first_name, last_name, job_title, and one of facility_name/facility_id" });
      continue;
    }

    // A raw facility_id, when given, is trusted as-is (backwards compatibility for
    // already-integrated callers) -- the employees_insert RLS with-check below still verifies it
    // belongs to a facility the caller may actually assign to, same as any other insert path.
    let facility_id: string;
    if (rawFacilityId) {
      facility_id = rawFacilityId;
    } else {
      const resolved = facilityIdByName.get(rawFacilityName!.toLowerCase());
      if (!resolved) {
        results.push({ row: rowNumber, success: false, error: `Unknown facility: ${rawFacilityName}` });
        continue;
      }
      facility_id = resolved;
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
