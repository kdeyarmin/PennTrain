// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { getAnthropicModelCandidates } from "../_shared/anthropicModels.ts";
import { orgAiAllowed, orgAiDisabledBody } from "../_shared/orgAiGate.ts";
import { AliasDirectory, redactAssessmentContent } from "../_shared/aiRedaction.ts";

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

const ALLOWED_ROLES = ["platform_admin", "org_admin", "facility_manager"];

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const PRIMARY_MODEL_ENV = "ANTHROPIC_RESIDENT_SUMMARY_MODEL";
const FALLBACK_MODELS_ENV = "ANTHROPIC_RESIDENT_SUMMARY_FALLBACK_MODELS";

const TOOL_NAME = "emit_wellness_summary";
const MAX_TOKENS = 1200;
const ANTHROPIC_TIMEOUT_MS = 60_000;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "A concise, professional overall wellness summary suitable for the assessment form.",
    },
    suggested_additions: {
      type: "array",
      description: "Optional summary-ready sentences that are directly supported by documented assessment facts but were not necessary in the concise summary. Return an empty array if none are verified.",
      items: { type: "string" },
    },
    follow_up_questions: {
      type: "array",
      description: "Optional reviewer questions for important gaps or ambiguous areas. These are not summary text and must not assert an answer.",
      items: { type: "string" },
    },
    grounding_checklist: {
      type: "object",
      description: "Mandatory self-check that the summary and suggested additions are grounded only in the provided assessment.",
      properties: {
        only_uses_documented_facts: { type: "boolean" },
        no_new_diagnoses_or_risk_levels: { type: "boolean" },
        no_external_regulatory_or_medical_claims: { type: "boolean" },
        covers_documented_priority_domains: { type: "boolean" },
      },
      required: [
        "only_uses_documented_facts",
        "no_new_diagnoses_or_risk_levels",
        "no_external_regulatory_or_medical_claims",
        "covers_documented_priority_domains",
      ],
    },
  },
  required: ["summary", "suggested_additions", "follow_up_questions", "grounding_checklist"],
};

const SYSTEM_PROMPT = `You draft regulated personal-care-home resident assessment wellness summaries.

Non-negotiable grounding rules:
1. Use ONLY facts explicitly present in the provided assessment JSON. Do not infer, assume, generalize, or fill gaps from medical knowledge, regulations, or typical resident needs.
2. Do not create diagnoses, risk levels, care needs, abilities, limitations, preferences, behaviors, services, citations, dates, medications, or participant statements that are not documented in the assessment JSON.
3. If a domain is blank, absent, contradictory, or not assessed, either omit it or state that it was not documented. Never convert missing data into a normal finding.
4. Do not mention specific regulation numbers, statutes, or agency requirements unless those exact strings appear in the assessment JSON.
5. Keep the summary neutral and review-ready. The assessor remains responsible for validating the draft before finalizing the form.
6. Person names and room numbers in the assessment JSON are pseudonymized as stable aliases ("Resident 1", "Staff 2", "Person 3", "Room 1"), and direct identifiers (SSNs, phone numbers, email addresses, street addresses, exact birth dates) have been removed. Refer to the resident as "the resident" or by the exact alias, and to any other person only by their exact alias; the application restores real names for authorized reviewers after generation. Never guess, invent, or reconstruct a real name or identifier, do not remark on the pseudonymization, and do not treat an alias or a removed identifier as a documentation gap.

What the summary should cover when documented:
- Overall functional status and ADL support needs, including supervision, mobility, eating, toileting, transfer, hygiene, dressing, and bathing.
- Physical health, medical diagnoses, dental, dietary, sensory, medication, and treatment-plan implications.
- Mental health, behavioral health, cognitive functioning, supervision needs, and any documented safety concerns.
- Social, recreational, communication, preferences, strengths, participation, and support-plan considerations.
- Any meaningful changes, unmet needs, or follow-up/service-planning implications that are directly supported by the assessment.

Suggestion/question guardrails:
- suggested_additions may contain only concise, summary-ready sentences that are directly and explicitly supported by assessment JSON but were not included in the main summary. Do not add suggestions based on blanks, assumptions, best practices, regulations, or medical knowledge.
- follow_up_questions should ask the human reviewer about missing, unclear, or contradictory details that may matter to the summary. Phrase them as questions only; do not imply the answer.
- If something cannot be verified from the assessment JSON, put it in follow_up_questions instead of suggested_additions.

Write 1-3 concise paragraphs. Return no more than 5 suggested_additions and no more than 5 follow_up_questions. Call the emit_wellness_summary tool exactly once, and set every grounding_checklist item truthfully. If you cannot satisfy a checklist item, return the safest narrow summary, keep suggested_additions empty, ask questions for gaps, and mark that item false.`;

interface GenerateSummaryRequestBody {
  formId?: string;
}

interface AnthropicCallResult {
  ok: boolean;
  model: string;
  status: number;
  body: Record<string, unknown> | null;
}

interface ResidentAssessmentFormRow {
  id: string;
  organization_id: string;
  facility_id: string;
  resident_id: string;
  status: string;
  content: Record<string, unknown> | null;
  form_type: string;
  reason: string;
}

async function callAnthropicWithFallback(
  apiKey: string,
  userPrompt: string,
  signal: AbortSignal,
  candidates: string[],
): Promise<AnthropicCallResult> {
  let last: AnthropicCallResult | null = null;

  for (const model of candidates) {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        tools: [{ name: TOOL_NAME, description: "Emit the wellness summary.", input_schema: SUMMARY_SCHEMA }],
        tool_choice: { type: "tool", name: TOOL_NAME },
      }),
      signal,
    });
    const bodyJson = await res.json().catch(() => null);
    if (res.ok) return { ok: true, model, status: res.status, body: bodyJson };

    const errorMessage = typeof bodyJson?.error?.message === "string" ? bodyJson.error.message : "";
    const canFallback = res.status === 404 || res.status === 429 || res.status >= 500 || (res.status === 400 && /model/i.test(errorMessage));
    last = { ok: false, model, status: res.status, body: bodyJson };
    if (!canFallback) return last;
  }

  return last!;
}

interface WellnessSummaryToolInput {
  summary: string;
  suggested_additions: string[];
  follow_up_questions: string[];
  grounding_checklist: {
    only_uses_documented_facts: boolean;
    no_new_diagnoses_or_risk_levels: boolean;
    no_external_regulatory_or_medical_claims: boolean;
    covers_documented_priority_domains: boolean;
  };
}

function extractToolInput(anthropicBody: Record<string, unknown> | null): WellnessSummaryToolInput | null {
  const content = (anthropicBody as { content?: unknown[] } | null)?.content;
  if (!Array.isArray(content)) return null;

  const block = content.find((b) => {
    const candidate = b as { type?: string; name?: string };
    return candidate.type === "tool_use" && candidate.name === TOOL_NAME;
  });
  const input = (block as { input?: Record<string, unknown> } | undefined)?.input;
  const summary = input?.summary;
  const suggestedAdditions = input?.suggested_additions;
  const followUpQuestions = input?.follow_up_questions;
  const checklist = input?.grounding_checklist as Partial<WellnessSummaryToolInput["grounding_checklist"]> | undefined;

  if (typeof summary !== "string" || !summary.trim() || !checklist) return null;
  if (!Array.isArray(suggestedAdditions) || !suggestedAdditions.every((item) => typeof item === "string")) return null;
  if (!Array.isArray(followUpQuestions) || !followUpQuestions.every((item) => typeof item === "string")) return null;
  if (typeof checklist.only_uses_documented_facts !== "boolean") return null;
  if (typeof checklist.no_new_diagnoses_or_risk_levels !== "boolean") return null;
  if (typeof checklist.no_external_regulatory_or_medical_claims !== "boolean") return null;
  if (typeof checklist.covers_documented_priority_domains !== "boolean") return null;

  return {
    summary: summary.trim(),
    suggested_additions: suggestedAdditions.map((item) => item.trim()).filter(Boolean).slice(0, 5),
    follow_up_questions: followUpQuestions.map((item) => item.trim()).filter(Boolean).slice(0, 5),
    grounding_checklist: {
      only_uses_documented_facts: checklist.only_uses_documented_facts,
      no_new_diagnoses_or_risk_levels: checklist.no_new_diagnoses_or_risk_levels,
      no_external_regulatory_or_medical_claims: checklist.no_external_regulatory_or_medical_claims,
      covers_documented_priority_domains: checklist.covers_documented_priority_domains,
    },
  };
}

function groundingChecklistPassed(checklist: WellnessSummaryToolInput["grounding_checklist"]) {
  return (
    checklist.only_uses_documented_facts
    && checklist.no_new_diagnoses_or_risk_levels
    && checklist.no_external_regulatory_or_medical_claims
    && checklist.covers_documented_priority_domains
  );
}

function compactAssessmentForPrompt(content: Record<string, unknown>) {
  // Do not ask the model to rewrite its own previous answer when the field already has text; the
  // summary field is the output target, while the other sections are the source-of-truth inputs.
  const contentWithoutExistingSummary = {
    ...content,
    summary: undefined,
  };
  return JSON.stringify(
    contentWithoutExistingSummary,
    (_key, value) => (value === "" || value === null ? undefined : value),
    2,
  ).slice(0, 45_000);
}

function anthropicErrorMessage(result: AnthropicCallResult) {
  return (result.body as { error?: { message?: string } } | null)?.error?.message ?? `Anthropic API returned ${result.status}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const callerClient = createClient<any>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json({ error: "Caller profile not found or inactive" }, 403);
  }
  if (!ALLOWED_ROLES.includes(callerProfile.role as string)) {
    return json({ error: "not authorized to generate resident assessment wellness summaries" }, 403);
  }
  if (!serviceRoleKey) return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, 500);
  const privilegedClient = createClient<any>(supabaseUrl, serviceRoleKey);

  // get_platform_setting() was dropped by 20260706043940; read the settings row directly
  // with the privileged client, the same pattern compliance-copilot uses. Fail closed.
  const { data: aiGenerationSetting, error: aiGenerationSettingError } = await privilegedClient
    .from("platform_settings")
    .select("value")
    .eq("key", "ai_wellness_summary_generation_enabled")
    .maybeSingle();
  if (aiGenerationSettingError) {
    return json({ error: "Failed to read platform AI settings" }, 500);
  }
  if (aiGenerationSetting?.value !== true) {
    return json({ error: "AI wellness summary generation is currently disabled by the platform administrator." }, 403);
  }

  // Checked only after auth/role so secret configuration does not leak ahead of authorization.
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);

  let body: GenerateSummaryRequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.formId) return json({ error: "formId is required" }, 400);

  const { data: formRaw, error: formError } = await callerClient
    .from("resident_assessment_forms")
    .select("id, organization_id, facility_id, resident_id, status, content, form_type, reason")
    .eq("id", body.formId)
    .single();
  if (formError || !formRaw) return json({ error: "resident assessment form not found" }, 404);

  const form = formRaw as ResidentAssessmentFormRow;
  if (form.status !== "draft") return json({ error: "AI summaries can only be generated for draft forms" }, 409);

  // PT-019: per-organization BAA gate, on top of the platform switch above. The
  // assessment form's organization_id is the org derivation this function already
  // uses for its audit rows -- and the assessment content is PHI, so this endpoint
  // must never reach the provider without a recorded BAA (or a demo org).
  if (!(await orgAiAllowed(callerClient, form.organization_id))) {
    return json(orgAiDisabledBody(), 403);
  }

  // PT-026: unconditional pseudonymization / direct-identifier minimization --
  // there is deliberately no toggle. Every person name this request can know
  // about is registered under the caller's own RLS: the resident (with lone
  // first/last-name matching, since bare given names in narrative text refer
  // to them), their room, designated person, external providers, informal
  // supports, and facility staff. redactAssessmentContent() then aliases the
  // structural name fields, replaces registered names in free text, and
  // strips SSN-like strings, phone numbers, emails, street addresses, and
  // exact birthdates (reduced to the year) before anything is sent to the
  // provider. Aliases are re-substituted into the generated summary below.
  // Honest boundary: a name that appears only in free text and matches no
  // registered person passes through, and administrative dates (assessment /
  // signature dates) are kept. Fails closed -- a directory build error stops
  // the request before any provider call.
  const directory = new AliasDirectory();
  {
    const [residentResult, supportsResult, staffResult] = await Promise.all([
      callerClient
        .from("residents")
        .select("first_name, last_name, room, designated_person_name, primary_physician_name, dentist_name, case_manager_name")
        .eq("id", form.resident_id)
        .maybeSingle(),
      callerClient.from("resident_informal_supports").select("name").eq("resident_id", form.resident_id).limit(50),
      callerClient.from("employees").select("id, first_name, last_name").eq("facility_id", form.facility_id).order("id").limit(2000),
    ]);
    const directoryError = residentResult.error ?? supportsResult.error ?? staffResult.error;
    if (directoryError) {
      return json({ error: "Failed to prepare the privacy pseudonymization layer" }, 500);
    }
    const resident = residentResult.data;
    if (resident) {
      directory.registerPerson("resident", { firstName: resident.first_name, lastName: resident.last_name }, { matchNameParts: true });
      directory.registerRoom(resident.room);
      for (const fullName of [
        resident.designated_person_name,
        resident.primary_physician_name,
        resident.dentist_name,
        resident.case_manager_name,
      ]) {
        directory.registerPerson("person", { fullName });
      }
    }
    for (const row of supportsResult.data ?? []) directory.registerPerson("person", { fullName: row.name });
    for (const row of staffResult.data ?? []) {
      directory.registerPerson("staff", { firstName: row.first_name, lastName: row.last_name });
    }
  }
  const redactedContent = redactAssessmentContent((form.content ?? {}) as Record<string, unknown>, directory);

  const modelCandidates = getAnthropicModelCandidates(PRIMARY_MODEL_ENV, FALLBACK_MODELS_ENV);
  const requestedModel = modelCandidates[0];

  // Audit metadata intentionally excludes assessment answers and generated text; the source content
  // remains only on resident_assessment_forms.content. The redaction entry records only counts --
  // this audit table deliberately stores no PHI, so the alias map (real names) is never persisted
  // here; re-substitution happens in-request only.
  const requestParams = {
    form_type: form.form_type,
    reason: form.reason,
    content_chars: JSON.stringify(form.content ?? {}).length,
    redaction: { alias_count: directory.size },
  };
  const { data: generationRow, error: generationInsertError } = await privilegedClient
    .from("resident_assessment_ai_generations")
    .insert({
      organization_id: form.organization_id,
      facility_id: form.facility_id,
      resident_assessment_form_id: form.id,
      requested_by: callerUser.id,
      model: requestedModel,
      request_params: requestParams,
      status: "pending",
    })
    .select("id")
    .single();
  if (generationInsertError || !generationRow) {
    return json({ error: generationInsertError?.message ?? "failed to create audit record for this generation" }, 500);
  }
  const generationId = generationRow.id as string;

  async function markFailed(errorMessage: string) {
    await privilegedClient
      .from("resident_assessment_ai_generations")
      .update({ status: "failed", error_message: errorMessage })
      .eq("id", generationId);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  let result: AnthropicCallResult;
  try {
    result = await callAnthropicWithFallback(
      anthropicApiKey,
      // PT-026: only the pseudonymized document is serialized into the prompt.
      `Assessment JSON:\n${compactAssessmentForPrompt(redactedContent)}`,
      controller.signal,
      modelCandidates,
    );
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      await markFailed(`Anthropic API request timed out after ${ANTHROPIC_TIMEOUT_MS / 1000}s`);
      return json({ error: "AI wellness summary generation timed out", generation_id: generationId }, 504);
    }
    const message = e instanceof Error ? e.message : String(e);
    await markFailed(message);
    return json({ error: "AI wellness summary generation failed", generation_id: generationId }, 502);
  }
  clearTimeout(timeoutId);

  if (result.model !== requestedModel) {
    await privilegedClient
      .from("resident_assessment_ai_generations")
      .update({ model: result.model })
      .eq("id", generationId);
  }

  if (!result.ok) {
    const message = anthropicErrorMessage(result);
    await markFailed(message);
    return json({ error: "AI wellness summary generation failed", generation_id: generationId }, 502);
  }

  const toolInput = extractToolInput(result.body);
  if (!toolInput) {
    await markFailed("AI response did not include a valid wellness summary and grounding checklist");
    return json({ error: "AI response did not include a valid wellness summary", generation_id: generationId }, 502);
  }
  if (!groundingChecklistPassed(toolInput.grounding_checklist)) {
    await markFailed("AI response failed the grounding checklist");
    return json({ error: "AI response could not verify that the summary was fully grounded in the assessment", generation_id: generationId }, 502);
  }

  // PT-026: re-substitute real names for the aliases in the model's output so
  // the assessor reads real names; the provider never saw them.
  const summary = directory.restoreText(toolInput.summary);
  const suggestedAdditions = toolInput.suggested_additions.map((item) => directory.restoreText(item));
  const followUpQuestions = toolInput.follow_up_questions.map((item) => directory.restoreText(item));

  await privilegedClient
    .from("resident_assessment_ai_generations")
    .update({
      status: "completed",
      model: result.model,
      response_summary: {
        summary_length: summary.length,
        suggested_additions_count: suggestedAdditions.length,
        follow_up_questions_count: followUpQuestions.length,
        grounding_checklist: toolInput.grounding_checklist,
      },
    })
    .eq("id", generationId);

  return json({
    summary,
    suggested_additions: suggestedAdditions,
    follow_up_questions: followUpQuestions,
    generation_id: generationId,
    model: result.model,
  });
});
