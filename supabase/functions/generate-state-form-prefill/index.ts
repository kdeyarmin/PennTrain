// @ts-nocheck -- retained: npm pdf-lib module causes widespread type errors
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFName } from "npm:pdf-lib@1.17.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import {
  fetchDhsTemplate,
  stripXfa,
} from "../_shared/dhsStateFormFill.ts";
import { toWinAnsi } from "../_shared/pdfText.ts";

// Prefills the official PA DHS PDF for the two upload-only compliance item types (preadmission
// screening, medical evaluation/DME) with the resident's demographics and stores it as a
// "start from this" drafting aid. It fills identity fields only -- never clinical content, and
// never the assessor/completion dates -- and the stored document is is_state_form=false, so it
// can never satisfy complete_resident_compliance_item()'s state-form requirement. The signed
// paper form staff upload later is the only completion evidence, no exception.


function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const DOCUMENTS_BUCKET = "resident-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

// Mirrors artifacts/caremetric-carebase/src/lib/residentCompliance.ts's DHS form URLs -- duplicated
// here (a Deno edge function can't import from the frontend package) and must stay in sync if
// that file's URLs ever change.
//
// FIELD PINNING (BACKLOG.md J74, Policy -- the second function with I10's shape).
//
// The identity fields used to be found by fuzzy word-set matching over the template's AcroForm
// names: the first field whose normalized name contained every word of a set. That is how I10
// describes the incident form's mapping, and it has the same failure here -- the mapping is decided
// by whatever DHS happens to have named a widget, in template order, with nothing recording what
// was actually verified. Two concrete traps in these four PDFs:
//
//   * The DME forms carry both `Name` (the resident, page 1) and `Medical Professional Name`, and
//     the third tier of the old resident-name set was the single word `name`. It landed on `Name`
//     only because `Name` happens to come first in field order.
//   * The ALR preadmission form's facility field is `ResidenceNameAndAddressTextField[0]`, whose
//     normalized name contains "resident" -- if the `["resident","name"]` tier had missed, the
//     resident's name would have been typed into the residence box.
//
// So the mapping is pinned to exact field names, per template. `null` means the form genuinely has
// no such field, which is a fact worth recording rather than a match that silently never happens:
// no DHS form here has an admission-date field, and the ALR preadmission form has no date of birth.
//
// Verified 2026-09-06 by downloading each URL below and enumerating `doc.getForm().getFields()`
// after the same `stripXfa` this function performs -- 85, 47, 173 and 174 fields respectively.
// DHS versions these documents in the URL (see dhsTemplateCacheKey), so a new form is a new URL and
// a new entry here. If DHS re-uploads under the same URL with renamed fields, the prefill fills
// fewer fields and the response's `fieldsFilled` drops -- it can never fill the wrong one.
interface DhsPrefillFieldMap {
  /** Resident name, "Last, First". */
  residentName: string | null;
  dateOfBirth: string | null;
  facilityName: string | null;
  admissionDate: string | null;
}

type DhsPrefillTemplate = {
  url: string;
  sourceLabel: string;
  fileLabel: string;
  fields: DhsPrefillFieldMap;
};

// Shared by `medical_evaluation` and `annual_medical_evaluation` below -- one form, two cycles.
const MEDICAL_EVALUATION_TEMPLATES: Record<string, DhsPrefillTemplate> = {
  PCH: {
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-07-25-personal-care-homes-dme-reupload.pdf",
    sourceLabel: "PA DHS Personal Care Home DME form",
    fileLabel: "DME",
    // Page-1 identity block. `Name_2` on the continuation page names the same resident and is left
    // to the person completing the form, exactly as before. No facility or admission-date field
    // exists on this form.
    fields: {
      residentName: "Name",
      dateOfBirth: "Date of Birth",
      facilityName: null,
      admissionDate: null,
    },
  },
  ALR: {
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-07-24-assisted-living-residences-dme.pdf",
    sourceLabel: "PA DHS Assisted Living Facility (ALF) DME form",
    fileLabel: "DME",
    fields: {
      residentName: "Name",
      dateOfBirth: "Date of Birth",
      facilityName: null,
      admissionDate: null,
    },
  },
};

const DHS_PREFILL_TEMPLATES: Record<string, Record<string, DhsPrefillTemplate>> = {
  preadmission_screening: {
    PCH: {
      url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Home-Preadmission-Screening.pdf",
      sourceLabel: "PA DHS Personal Care Home Preadmission Screening form",
      fileLabel: "Preadmission Screening",
      // LiveCycle export; the screener block on subform[2] carries the identity fields. There is no
      // admission-date field -- the form records the SCREENING date, which this function must never
      // fill because it attests to work the staff member has not done yet.
      fields: {
        residentName: "form1[0].#subform[2].ApplicantNameTextfield[0]",
        dateOfBirth: "form1[0].#subform[2].ApplicantBirthDateField[0]",
        facilityName: "form1[0].#subform[2].AdmittingPersonalCareHomeNameTextField[0]",
        admissionDate: null,
      },
    },
    ALR: {
      url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living-Preadmission_Screening_Form.pdf",
      sourceLabel: "PA DHS Assisted Living Facility (ALF) Preadmission Screening form",
      fileLabel: "Preadmission Screening",
      // This form has 47 fields and none of them is a date of birth or an admission date; the
      // resident is identified by name only. `ResidenceNameAndAddressTextField[0]` is the FACILITY
      // field despite containing the letters "resident".
      fields: {
        residentName: "form1[0].#subform[0].ResidentNameTextField[0]",
        dateOfBirth: null,
        facilityName: "form1[0].#subform[0].ResidenceNameAndAddressTextField[0]",
        admissionDate: null,
      },
    },
  },
  medical_evaluation: MEDICAL_EVALUATION_TEMPLATES,
  // The annual cycle prefills from the same document. DHS publishes one Medical Evaluation form per
  // setting type, used both at admission and for the annual re-evaluation; splitting the item types
  // (20260804170000) split the schedule, not the paperwork. Without this key an annual row reached
  // the State Forms Center and got the "prefill only available" 400, which reads as "we do not have
  // that form" when the form is the one directly above.
  annual_medical_evaluation: MEDICAL_EVALUATION_TEMPLATES,
};

/**
 * Fill one named AcroForm text field, or do nothing.
 *
 * The counterpart of the shared `setFirstMatchingTextField` for a pinned mapping: no word sets, no
 * "first field that looks close enough". A name that is not on the template (DHS renamed it, or the
 * form never had it) fills nothing and is reported through `fieldsFilled`. `lock` is always false
 * here -- this is a drafting aid the user finishes themselves.
 */
// deno-lint-ignore no-explicit-any
function setTextFieldByExactName(form: any, fieldName: string | null, value: string | null | undefined): boolean {
  if (!fieldName || !value) return false;
  for (const field of form.getFields()) {
    if (field.getName() !== fieldName) continue;
    if (typeof field.setText !== "function") return false;
    try {
      // Same WinAnsi boundary the shared filler applies: appearance regeneration throws on
      // non-CP1252 characters when the template's appearance font is a standard one, which used to
      // fail the whole export on a resident whose name carries one.
      field.setText(toWinAnsi(String(value)));
      return true;
    } catch (_) {
      return false;
    }
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: callerUser },
    error: callerAuthError,
  } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser)
    return json(req, { error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, organization_id, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json(req, { error: "Caller profile not found or inactive" }, 403);
  }

  let body: { complianceItemId?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const { complianceItemId } = body;
  if (!complianceItemId) return json(req, { error: "complianceItemId is required" }, 400);

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
  if (itemError) return json(req, { error: itemError.message }, 500);
  if (!item) return json(req, { error: "Compliance item not found" }, 404);

  const templatesForType = DHS_PREFILL_TEMPLATES[item.item_type];
  if (!templatesForType) {
    return json(req,
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
    return json(req,
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
    return json(req, { error: "Not authorized to generate this document" }, 403);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
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
      return json(req, { error: signedError?.message ?? "failed to create signed url" }, 500);
    }
    return json(req, {
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
  if (!resident) return json(req, { error: "Resident not found" }, 404);

  const templateBytes = await fetchDhsTemplate(template, adminClient);
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
    // Identity fields only, filled by their pinned exact names (see DHS_PREFILL_FIELDS above) and
    // without locking (lock=false) so staff can correct them. "date form completed" / "screening
    // completed" style fields are deliberately never touched -- those attest to work the staff
    // member hasn't done yet.
    const fills: Array<{ fieldName: string | null; value: string | null | undefined }> = [
      { fieldName: template.fields.residentName, value: residentName },
      { fieldName: template.fields.dateOfBirth, value: resident.date_of_birth },
      { fieldName: template.fields.facilityName, value: facility?.name ?? null },
      { fieldName: template.fields.admissionDate, value: resident.admission_date },
    ];
    for (const fill of fills) {
      if (setTextFieldByExactName(form, fill.fieldName, fill.value)) fieldsFilled += 1;
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
  if (uploadError) return json(req, { error: uploadError.message }, 500);

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
    return json(req, { error: docError.message }, 500);
  }

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return json(req, { error: signedUrlError?.message ?? "failed to create signed url" }, 500);
  }

  return json(req, {
    success: true,
    documentId: insertedDoc.id,
    url: signedUrlData.signedUrl,
    fieldsFilled,
    expiresIn: SIGNED_URL_TTL_SECONDS,
  });
});
