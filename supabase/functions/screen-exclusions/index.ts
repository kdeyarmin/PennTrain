// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { parse } from "jsr:@std/csv@1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";

// Internal cron-only endpoint: invoked monthly by pg_cron via net.http_post (see
// supabase/migrations/20260705160732_schedule_exclusion_screening.sql). Deliberately
// verify_jwt:false because pg_net has no user JWT; authenticity is enforced here with
// CRON_SHARED_SECRET / x-caremetric-cron-secret.

const CORS_HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const LEIE_CSV_URL = "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv";
const INSERT_BATCH_SIZE = 1000;
const SAM_GOV_BASE_URL = "https://api.sam.gov/entity-information/v4/exclusions";
const NOT_CONFIGURED_SAM = "SAM_GOV_API_KEY is not set -- SAM.gov exclusion screening is skipped for this deployment (OIG LEIE screening still runs).";

interface ExclusionListEntryRow {
  source: "oig_leie" | "sam_exclusions";
  last_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  business_name: string | null;
  dob: string | null;
  exclusion_type: string | null;
  exclusion_date: string | null;
  reinstate_date: string | null;
  waiver_date: string | null;
  npi: string | null;
  upin: string | null;
  raw: Record<string, string>;
}

// LEIE date fields are YYYYMMDD, zero-filled ("00000000") when not applicable.
function parseLeieDate(value: string | undefined): string | null {
  if (!value || value === "00000000" || value.length !== 8) return null;
  const y = value.slice(0, 4), m = value.slice(4, 6), d = value.slice(6, 8);
  return `${y}-${m}-${d}`;
}

async function ingestOigLeie(adminClient: ReturnType<typeof createClient>): Promise<{ imported: number }> {
  const resp = await fetch(LEIE_CSV_URL);
  if (!resp.ok) throw new Error(`Failed to download LEIE CSV: HTTP ${resp.status}`);
  const text = await resp.text();
  const rows = parse(text, { skipFirstRow: true, columns: [
    "LASTNAME", "FIRSTNAME", "MIDNAME", "BUSNAME", "GENERAL", "SPECIALTY", "UPIN", "NPI", "DOB",
    "ADDRESS", "CITY", "STATE", "ZIP", "EXCLTYPE", "EXCLDATE", "REINDATE", "WAIVERDATE", "WVRSTATE",
  ] }) as Record<string, string>[];

  // Business-only exclusions (blank LASTNAME) can't match against an individual employee's name,
  // so they're dropped here rather than carried into the roster-matching table.
  const entries: ExclusionListEntryRow[] = rows
    .filter((r) => r.LASTNAME && r.LASTNAME.trim().length > 0)
    .map((r) => ({
      source: "oig_leie",
      last_name: r.LASTNAME.trim(),
      first_name: r.FIRSTNAME?.trim() || null,
      middle_name: r.MIDNAME?.trim() || null,
      business_name: r.BUSNAME?.trim() || null,
      dob: parseLeieDate(r.DOB),
      exclusion_type: r.EXCLTYPE?.trim() || null,
      exclusion_date: parseLeieDate(r.EXCLDATE),
      reinstate_date: parseLeieDate(r.REINDATE),
      waiver_date: parseLeieDate(r.WAIVERDATE),
      npi: r.NPI?.trim() || null,
      upin: r.UPIN?.trim() || null,
      raw: r,
    }));

  const { error: deleteError } = await adminClient.from("exclusion_list_entries").delete().eq("source", "oig_leie");
  if (deleteError) throw new Error(`Failed to clear previous OIG LEIE snapshot: ${deleteError.message}`);

  for (let i = 0; i < entries.length; i += INSERT_BATCH_SIZE) {
    const batch = entries.slice(i, i + INSERT_BATCH_SIZE);
    const { error: insertError } = await adminClient.from("exclusion_list_entries").insert(batch);
    if (insertError) throw new Error(`Failed to insert LEIE batch at offset ${i}: ${insertError.message}`);
  }

  return { imported: entries.length };
}

interface SamExclusionRecord {
  classification?: string;
  exclusionType?: { term?: string };
  activeDate?: string;
  terminationDate?: string;
  samNumber?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
}

// SAM.gov's free tier is a registered (not anonymous) name-search API, not a bulk download --
// see api.sam.gov/entity-information/v4/exclusions. Queried once per active employee name; the
// low daily rate limit on personal accounts (as few as ~10 requests/day) makes this realistically
// only usable with a registered system account's key, hence the graceful skip below when no key
// is configured (same pattern as SENDGRID_API_KEY/TWILIO_* in dispatch-notifications).
async function ingestSamGovForEmployee(
  apiKey: string,
  firstName: string,
  lastName: string,
): Promise<ExclusionListEntryRow[]> {
  const url = `${SAM_GOV_BASE_URL}?api_key=${encodeURIComponent(apiKey)}&firstName=${encodeURIComponent(firstName)}&lastName=${encodeURIComponent(lastName)}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json().catch(() => null) as { excludedEntity?: SamExclusionRecord[] } | null;
  const records = data?.excludedEntity ?? [];
  return records.map((r) => ({
    source: "sam_exclusions" as const,
    last_name: r.lastName?.trim() || lastName,
    first_name: r.firstName?.trim() || firstName,
    middle_name: null,
    business_name: null,
    dob: null,
    exclusion_type: r.exclusionType?.term ?? r.classification ?? null,
    exclusion_date: r.activeDate ?? null,
    reinstate_date: r.terminationDate ?? null,
    waiver_date: null,
    npi: null,
    upin: r.samNumber ?? null,
    raw: r as unknown as Record<string, string>,
  }));
}

async function ingestSamGov(adminClient: ReturnType<typeof createClient>): Promise<{ skipped: boolean; imported: number }> {
  const apiKey = Deno.env.get("SAM_GOV_API_KEY");
  if (!apiKey) {
    console.log(NOT_CONFIGURED_SAM);
    return { skipped: true, imported: 0 };
  }

  const { data: employees, error } = await adminClient
    .from("employees")
    .select("first_name, last_name")
    .eq("status", "active");
  if (error) throw new Error(`Failed to load roster for SAM.gov screening: ${error.message}`);

  const { error: deleteError } = await adminClient.from("exclusion_list_entries").delete().eq("source", "sam_exclusions");
  if (deleteError) throw new Error(`Failed to clear previous SAM.gov snapshot: ${deleteError.message}`);

  let imported = 0;
  for (const emp of employees ?? []) {
    const entries = await ingestSamGovForEmployee(apiKey, emp.first_name, emp.last_name);
    if (entries.length > 0) {
      const { error: insertError } = await adminClient.from("exclusion_list_entries").insert(entries);
      if (insertError) throw new Error(`Failed to insert SAM.gov entries for ${emp.first_name} ${emp.last_name}: ${insertError.message}`);
      imported += entries.length;
    }
  }
  return { skipped: false, imported };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const cronAuthError = requireCronRequest(req, CORS_HEADERS);
  if (cronAuthError) return cronAuthError;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);

  try {
    const leieResult = await ingestOigLeie(adminClient);
    const { error: leieMatchError } = await adminClient.rpc("match_exclusion_list_against_roster_core", {
      p_source: "oig_leie",
      p_organization_id: null,
    });
    if (leieMatchError) throw new Error(`OIG LEIE matching failed: ${leieMatchError.message}`);

    const samResult = await ingestSamGov(adminClient);
    if (!samResult.skipped) {
      const { error: samMatchError } = await adminClient.rpc("match_exclusion_list_against_roster_core", {
        p_source: "sam_exclusions",
        p_organization_id: null,
      });
      if (samMatchError) throw new Error(`SAM.gov matching failed: ${samMatchError.message}`);
    }

    return json({ success: true, oigLeie: leieResult, samGov: samResult });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("screen-exclusions failed:", message);
    return json({ success: false, error: message }, 500);
  }
});
