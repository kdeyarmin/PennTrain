// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFName } from "npm:pdf-lib@1.17.1";
import {
  fetchDhsTemplate,
  setFirstMatchingTextField,
  stripXfa,
} from "../_shared/dhsStateFormFill.ts";

// Prefills the official PA DHS PDF for the two upload-only compliance item types (preadmission
// screening, medical evaluation/DME) with the resident's demographics and stores it as a
// "start from this" drafting aid. It fills identity fields only -- never clinical content, and
// never the assessor/completion dates -- and the stored document is is_state_form=false, so it
// can never satisfy complete_resident_compliance_item()'s state-form requirement. The signed
// paper form staff upload later is the only completion evidence, no exception.

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

const DOCUMENTS_BUCKET = "resident-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

// Mirrors artifacts/caremetric-carebase/src/lib/residentCompliance.ts's DHS form URLs -- duplicated
// here (a Deno edge function can't import from the frontend package) and must stay in sync if
// that file's URLs ever change.
const DHS_PREFILL_TEMPLATES: Record<
  string,
  Record<string, { url: string; sourceLabel: string; fileLabel: string }>
> = {
  preadmission_screening: {
    PCH: {
      url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Home-Preadmission-Screening.pdf",
      sourceLabel: "PA DHS Personal Care Home Preadmission Screening form",
      fileLabel: "Preadmission Screening",
    },
    ALR: {
      url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living-Preadmission_Screening_Form.pdf",
      sourceLabel: "PA DHS Assisted Living Facility (ALF) Preadmission Screening form",
      fileLabel: "Preadmission Screening",
    },
  },
  medical_evaluation: {
    PCH: {
      url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-07-25-personal-care-homes-dme-reupload.pdf",
      sourceLabel: "PA DHS Personal Care Home DME form",
      fileLabel: "DME",
    },
    ALR: {
      url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-07-24-assisted-living-residences-dme.pdf",
      sourceLabel: "PA DHS Assisted Living Facility (ALF) DME form",
      fileLabel: "DME",
    },
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient<any>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: callerUser },
    error: callerAuthError,
  } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser)
    return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, organization_id, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json({ error: "Caller profile not found or inactive" }, 403);
  }

  let body: { complianceItemId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { complianceItemId } = body;
  if (!complianceItemId) return json({ error: "complianceItemId is required" }, 400);

  // RLS-scoped read on the caller's own client -- the select policy includes auditor, who must
  // not be able to trigger a service-role write, so an explicit write-role check (mirroring
  // resident_documents_insert's RLS policy) follows below, same as generate-resident-assessment-pdf.
  const { data: item, error: itemError } = await callerClient
    .from("resident_compliance_items")
    .select(
      "id, organization_id, facility_id, resident_id, item_type, status, " +
        "residents(first_name, last_name, date_of_birth, admission_date), " +
        "facilities(name, facility_type)",
    )
    .eq("id", complianceItemId)
    .maybeSingle();
  if (itemError) return json({ error: itemError.message }, 500);
  if (!item) return json({ error: "Compliance item not found" }, 404);

  const templatesForType = DHS_PREFILL_TEMPLATES[item.item_type];
  if (!templatesForType) {
    return json(
      { error: "Prefill is only available for preadmission screening and medical evaluation items" },
      400,
    );
  }

  const facility = item.facilities as unknown as {
    name: string;
    facility_type: string;
  } | null;
  const template = facility ? templatesForType[facility.facility_type] : undefined;
  if (!template) {
    return json(
      { error: "No PA DHS form is configured for this facility type" },
      400,
    );
  }

  const isPlatformAdmin = callerProfile.role === "platform_admin";
  const isOrgAdminInOrg =
    callerProfile.role === "org_admin" &&
    callerProfile.organization_id === item.organization_id;
  let hasWriteAccess = isPlatformAdmin || isOrgAdminInOrg;
  if (
    !hasWriteAccess &&
    callerProfile.role === "facility_manager" &&
    callerProfile.organization_id === item.organization_id
  ) {
    const { data: assignment } = await callerClient
      .from("facility_assignments")
      .select("id")
      .eq("profile_id", callerUser.id)
      .eq("facility_id", item.facility_id)
      .maybeSingle();
    hasWriteAccess = !!assignment;
  }
  if (!hasWriteAccess) {
    return json({ error: "Not authorized to generate this document" }, 403);
  }

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  const documentLabel = `state_form_prefill:${item.id}`;

  const existingResponse = async () => {
    const { data: existing } = await callerClient
      .from("resident_documents")
      .select("id, storage_path")
      .eq("resident_id", item.resident_id)
      .eq("document_label", documentLabel)
      .maybeSingle();
    if (!existing) return null;
    const { data: signed, error: signedError } = await adminClient.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(existing.storage_path, SIGNED_URL_TTL_SECONDS);
    // A real error, not a silent success-without-url: the document row exists but its file can't
    // be served right now, and the caller needs something actionable to surface.
    if (signedError || !signed) {
      return json({ error: signedError?.message ?? "failed to create signed url" }, 500);
    }
    return json({
      success: true,
      existing: true,
      documentId: existing.id,
      url: signed.signedUrl,
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  };

  // Unlike the finalized-assessment PDF (which refuses to regenerate so a locked document can't
  // drift), a prefill is a disposable drafting aid -- if one already exists, hand it back instead
  // of erroring. The unique (resident_id, document_label) index makes the racing-insert case
  // land in the 23505 handler below, which resolves the same way.
  const existing = await existingResponse();
  if (existing) return existing;

  const resident = item.residents as unknown as {
    first_name: string;
    last_name: string;
    date_of_birth: string | null;
    admission_date: string | null;
  } | null;
  if (!resident) return json({ error: "Resident not found" }, 404);

  const templateBytes = await fetchDhsTemplate(template);
  const doc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  // The preadmission PDFs are LiveCycle exports; drop the XFA layer so viewers show the AcroForm
  // values this code fills (see stripXfa's comment).
  stripXfa(doc, PDFName);

  let fieldsFilled = 0;
  let form: any = null;
  try {
    form = doc.getForm();
  } catch (_) {
    // Template exposes no AcroForm -- still store/return it: one click to the correct official
    // blank, linked to the right item, is the fallback behavior by design.
  }
  if (form) {
    const residentName = `${resident.last_name}, ${resident.first_name}`;
    // Identity fields only, filled without locking (lock=false) so staff can correct them.
    // Word sets are tiered most-specific-first; a fill counts once. "date form completed" /
    // "screening completed" style fields are deliberately never touched -- those attest to work
    // the staff member hasn't done yet.
    const fills: Array<{ wordSets: string[][]; value: string | null | undefined }> = [
      // Preadmission (LiveCycle names like ApplicantNameTextfield[0]) then DME ("Name").
      { wordSets: [["applicant", "name"], ["resident", "name"], ["name"]], value: residentName },
      { wordSets: [["applicant", "birth"], ["date", "birth"], ["birthdate"]], value: resident.date_of_birth },
      // PCH preadmission: AdmittingPersonalCareHomeNameTextField[0]; ALR preadmission:
      // ResidenceNameAndAddressTextField[0] ("residence" never collides with "resident..." names
      // -- verified against the live DHS PDFs). The DME forms carry no facility-name field.
      { wordSets: [["admitting", "name"], ["residence", "name"], ["facility", "name"], ["home", "name"]], value: facility?.name ?? null },
      { wordSets: [["admission", "date"], ["date", "admission"]], value: resident.admission_date },
    ];
    for (const fill of fills) {
      for (const wordSet of fill.wordSets) {
        if (setFirstMatchingTextField(form, [wordSet], fill.value, false)) {
          fieldsFilled += 1;
          break;
        }
      }
    }
    try {
      form.updateFieldAppearances();
    } catch (_) {
      // Appearance regeneration is best-effort; values are still in the field dictionaries.
    }
  }

  // Never flattened: the whole point is a fillable official form the user finishes themselves.
  const pdfBytes = await doc.save();

  const path = `${item.organization_id}/${item.facility_id}/${item.resident_id}-${item.item_type}-prefill-${item.id}.pdf`;
  const { error: uploadError } = await adminClient.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) return json({ error: uploadError.message }, 500);

  // is_state_form is explicitly false (matches the column default, but stated here so it can
  // never be mistaken for an oversight): a CareMetric-prefilled download is not the signed
  // DHS-prescribed form, and complete_resident_compliance_item() must never accept it.
  const { data: insertedDoc, error: docError } = await adminClient
    .from("resident_documents")
    .insert({
      organization_id: item.organization_id,
      facility_id: item.facility_id,
      resident_id: item.resident_id,
      compliance_item_id: item.id,
      storage_bucket: DOCUMENTS_BUCKET,
      storage_path: path,
      file_name: `${template.fileLabel} (prefilled).pdf`,
      file_type: "application/pdf",
      document_label: documentLabel,
      uploaded_by_profile_id: callerUser.id,
      is_state_form: false,
      state_form_source_label: template.sourceLabel,
      state_form_source_url: template.url,
    })
    .select("id")
    .single();
  if (docError) {
    if (docError.code === "23505") {
      const raced = await existingResponse();
      if (raced) return raced;
    }
    return json({ error: docError.message }, 500);
  }

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return json({ error: signedUrlError?.message ?? "failed to create signed url" }, 500);
  }

  return json({
    success: true,
    documentId: insertedDoc.id,
    url: signedUrlData.signedUrl,
    fieldsFilled,
    expiresIn: SIGNED_URL_TTL_SECONDS,
  });
});
