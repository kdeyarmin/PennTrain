// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import {
  checkFirstMatchingBox,
  fetchDhsTemplate,
  setFirstMatchingTextField,
} from "../_shared/dhsStateFormFill.ts";

// Auto-fills the official PA DHS "Reportable Incident Form" -- the same PDF for every licensed
// setting type DHS uses it for (PCH, ALR, and others; the form itself has one "which chapter"
// checkbox row rather than separate PCH/ALR editions -- verified by hashing the two DHS-posted
// filenames, which are byte-identical). Pulls identity, timing, staff-involved, and narrative
// content already captured on the incident; never invents investigation conclusions or reporter
// signatures. The stored PDF is a drafting/attachment aid, not a submission record -- staff still
// file the incident with DHS/BHSL through the Department's own required channel.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const REPORTS_BUCKET = "incident-reports";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

// Both DHS-posted filenames (Personal_Care_Homes-Reportable_Incident_Form-... and
// Assited_Living-Reportable_Incident_Form_...) resolve to the same document -- one template
// serves every facility type this app supports.
const INCIDENT_FORM_TEMPLATE = {
  url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Homes-Reportable_Incident_Form-Effective-October-1-2016.pdf",
  sourceLabel: "PA DHS Reportable Incident Form",
};

function humanize(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function datePart(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US");
}

function timePart(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  let body: { incidentId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { incidentId } = body;
  if (!incidentId) return json({ error: "incidentId is required" }, 400);

  // RLS-scoped read on the caller's own client: incidents_select already gates who can see this
  // incident (platform_admin, org_admin/auditor org-wide, facility_manager assigned to its
  // facility) -- matches generate-incident-report-pdf's posture, no separate write-access check.
  const { data: incident, error: incidentError } = await callerClient
    .from("incidents")
    .select(
      "id, organization_id, facility_id, incident_type, status, occurred_at, reported_by_profile_id, " +
        "narrative, investigation_findings, root_cause, final_report_submitted_at, " +
        "organizations(name), facilities(name, facility_type, license_number, address, city, state, zip, phone)",
    )
    .eq("id", incidentId)
    .maybeSingle();
  if (incidentError) return json({ error: incidentError.message }, 500);
  if (!incident) return json({ error: "Incident not found" }, 404);

  const facility = incident.facilities as unknown as {
    name: string; facility_type: string; license_number: string | null;
    address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null;
  } | null;
  const organizationName = (incident.organizations as unknown as { name: string } | null)?.name ?? "";

  const [
    { data: staff, error: staffError },
    { data: notifications, error: notificationsError },
    { data: correctiveActions, error: correctiveActionsError },
    { data: reporter, error: reporterError },
  ] = await Promise.all([
    callerClient
      .from("incident_staff_involved")
      .select("involvement_type, employees(first_name, last_name, job_title)")
      .eq("incident_id", incidentId)
      .order("created_at", { ascending: true }),
    callerClient
      .from("incident_notifications")
      .select("notification_type, completed_at")
      .eq("incident_id", incidentId)
      .eq("notification_type", "licensing_agency"),
    callerClient
      .from("corrective_actions")
      .select("description, status, owner_name")
      .eq("incident_id", incidentId)
      .order("created_at", { ascending: true }),
    incident.reported_by_profile_id
      ? callerClient
        .from("profiles")
        .select("first_name, last_name, phone")
        .eq("id", incident.reported_by_profile_id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (staffError) return json({ error: staffError.message }, 500);
  if (notificationsError) return json({ error: notificationsError.message }, 500);
  if (correctiveActionsError) return json({ error: correctiveActionsError.message }, 500);
  if (reporterError) return json({ error: reporterError.message }, 500);

  const templateBytes = await fetchDhsTemplate(INCIDENT_FORM_TEMPLATE);
  const doc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  let form: any = null;
  try {
    form = doc.getForm();
  } catch (_) {
    // No AcroForm on this download -- still store/return the unfilled official blank.
  }

  let fieldsFilled = 0;
  if (form) {
    const fillText = (wordSets: string[][], value: string | null | undefined) => {
      if (setFirstMatchingTextField(form, wordSets, value, false)) fieldsFilled += 1;
    };
    // Description of Incident / Follow-Up Action / Contact Information default to an auto-size
    // appearance on this template that overflows its box once the value wraps across several
    // lines (see setFirstMatchingTextField's fontSize param) -- these three are the only
    // multi-sentence free text on the form, so they're the only ones that need it fixed small.
    const fillLongText = (wordSets: string[][], value: string | null | undefined) => {
      if (setFirstMatchingTextField(form, wordSets, value, false, 9)) fieldsFilled += 1;
    };
    const check = (wordSets: string[][]) => {
      if (checkFirstMatchingBox(form, wordSets, false)) fieldsFilled += 1;
    };

    fillText([["legal", "entity"]], organizationName);
    fillText([["licensed", "setting"]], facility?.name ?? null);
    fillText(
      [["facility", "address"]],
      facility
        ? [facility.address, facility.city, facility.state, facility.zip].filter(Boolean).join(", ")
        : null,
    );
    fillText([["license", "number"]], facility?.license_number ?? null);
    fillText([["phone", "number"]], facility?.phone ?? null);
    // The "Regulatory Chapter" checkbox widgets are misnamed relative to what's printed next to
    // them on this template: the field named "2600" sits at an unlabeled 3rd checkbox position
    // with no visible caption, while the widget under the printed "2600" label is actually named
    // "2380", and the widget under printed "2800" is named "2390" (confirmed by rendering each
    // field's widget rectangle against the page -- this form was evidently adapted from a
    // multi-program template listing 2380/2390/2600/2800/3800/6400/6500 and only the first two
    // checkboxes were relabeled for the public PCH/ALR edition, not renamed). Checking "2600"/
    // "2800" directly would mark the wrong, unlabeled boxes.
    if (facility?.facility_type === "PCH") check([["2380"]]);
    if (facility?.facility_type === "ALR") check([["2390"]]);

    fillText([["date", "of", "incident"]], datePart(incident.occurred_at));
    fillText([["time", "of", "incident"]], timePart(incident.occurred_at));
    fillText([["regulation", "type"]], humanize(incident.incident_type));

    const departmentNotification = (notifications ?? []).find((n: any) => n.completed_at);
    if (departmentNotification) {
      fillText([["date", "incident", "reported"]], datePart(departmentNotification.completed_at));
      fillText([["time", "incident", "reported"]], timePart(departmentNotification.completed_at));
    }

    // The initial/final distinction tracks the incident's own lifecycle rather than being guessed
    // per submission -- "Final" once DHS's required final report has actually been recorded,
    // "Initial" otherwise. "InitialFinal" (a single combined report) is never inferred.
    check(incident.final_report_submitted_at ? [["final"]] : [["initial"]]);

    (staff ?? []).slice(0, 4).forEach((row: any, index: number) => {
      const n = index + 1;
      const employee = row.employees as { first_name: string; last_name: string; job_title: string } | null;
      if (!employee) return;
      fillText([[`row${n} 2`]], `${employee.last_name}, ${employee.first_name}`);
      fillText([["job", "title", `row${n}`]], employee.job_title);
    });

    fillLongText([["description", "of", "incident"]], incident.narrative);

    const followUp = (correctiveActions ?? [])
      .map((ca: any) => `${ca.description}${ca.owner_name ? ` (owner: ${ca.owner_name})` : ""} — ${humanize(ca.status)}`)
      .join("; ") || incident.investigation_findings || incident.root_cause || null;
    fillLongText([["followup", "action"]], followUp);

    const reporterProfile = reporter as { first_name: string; last_name: string; phone: string | null } | null;
    if (reporterProfile) {
      const reporterLabel = [
        `${reporterProfile.first_name} ${reporterProfile.last_name}`.trim(),
        reporterProfile.phone,
      ].filter(Boolean).join(" — ");
      fillLongText([["completing", "report"]], reporterLabel);
    }

    try {
      form.updateFieldAppearances();
    } catch (_) {
      // Appearance regeneration is best-effort; values are still in the field dictionaries.
    }
  }

  // Never flattened: the whole point is a fillable copy staff can review, correct, and complete
  // (signature, any field this app has no data for) before using it.
  const pdfBytes = await doc.save();

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  const path = `${incident.organization_id}/${incident.id}-state-form.pdf`;

  const { error: uploadError } = await adminClient.storage.from(REPORTS_BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const { error: updateError } = await adminClient
    .from("incidents")
    .update({
      state_form_pdf_storage_bucket: REPORTS_BUCKET,
      state_form_pdf_storage_path: path,
      state_form_pdf_generated_at: new Date().toISOString(),
    })
    .eq("id", incident.id);
  if (updateError) return json({ error: updateError.message }, 500);

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return json({ error: signedUrlError?.message ?? "failed to create signed url" }, 500);
  }

  return json({
    success: true,
    url: signedUrlData.signedUrl,
    fieldsFilled,
    sourceLabel: INCIDENT_FORM_TEMPLATE.sourceLabel,
    sourceUrl: INCIDENT_FORM_TEMPLATE.url,
    expiresIn: SIGNED_URL_TTL_SECONDS,
  });
});
