import { createClient } from "jsr:@supabase/supabase-js@2";

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
const PRIMARY_MODEL = "claude-sonnet-5";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
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
  status: string;
  content: Record<string, unknown> | null;
  form_type: string;
  reason: string;
}

async function callAnthropicWithFallback(
  apiKey: string,
  userPrompt: string,
  signal: AbortSignal,
): Promise<AnthropicCallResult> {
  let last: AnthropicCallResult | null = null;

  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
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
    const looksLikeModelError = res.status === 404 || (res.status === 400 && /model/i.test(errorMessage));
    last = { ok: false, model, status: res.status, body: bodyJson };
    if (!looksLikeModelError) return last;
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
  const callerClient = createClient(supabaseUrl, anonKey, {
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

  const { data: aiGenerationSetting, error: aiGenerationSettingError } = await callerClient
    .rpc("get_platform_setting", { p_key: "ai_wellness_summary_generation_enabled" });
  if (aiGenerationSettingError) {
    return json({ error: "Failed to read platform AI settings" }, 500);
  }
  if (aiGenerationSetting !== true) {
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
    .select("id, organization_id, facility_id, status, content, form_type, reason")
    .eq("id", body.formId)
    .single();
  if (formError || !formRaw) return json({ error: "resident assessment form not found" }, 404);

  const form = formRaw as ResidentAssessmentFormRow;
  if (form.status !== "draft") return json({ error: "AI summaries can only be generated for draft forms" }, 409);

  // Audit metadata intentionally excludes assessment answers and generated text; the source content
  // remains only on resident_assessment_forms.content.
  const requestParams = {
    form_type: form.form_type,
    reason: form.reason,
    content_chars: JSON.stringify(form.content ?? {}).length,
  };
  const { data: generationRow, error: generationInsertError } = await callerClient
    .from("resident_assessment_ai_generations")
    .insert({
      organization_id: form.organization_id,
      facility_id: form.facility_id,
      resident_assessment_form_id: form.id,
      requested_by: callerUser.id,
      model: PRIMARY_MODEL,
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
    await callerClient
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
      `Assessment JSON:\n${compactAssessmentForPrompt(form.content ?? {})}`,
      controller.signal,
    );
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      await markFailed(`Anthropic API request timed out after ${ANTHROPIC_TIMEOUT_MS / 1000}s`);
      return json({ error: "AI wellness summary generation timed out", generation_id: generationId }, 504);
    }
    const message = e instanceof Error ? e.message : String(e);
    await markFailed(message);
    return json({ error: message, generation_id: generationId }, 502);
  }
  clearTimeout(timeoutId);

  if (!result.ok) {
    const message = anthropicErrorMessage(result);
    await markFailed(message);
    return json({ error: message, generation_id: generationId }, 502);
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

  await callerClient
    .from("resident_assessment_ai_generations")
    .update({
      status: "completed",
      model: result.model,
      response_summary: {
        summary_length: toolInput.summary.length,
        suggested_additions_count: toolInput.suggested_additions.length,
        follow_up_questions_count: toolInput.follow_up_questions.length,
        grounding_checklist: toolInput.grounding_checklist,
      },
    })
    .eq("id", generationId);

  return json({
    summary: toolInput.summary,
    suggested_additions: toolInput.suggested_additions,
    follow_up_questions: toolInput.follow_up_questions,
    generation_id: generationId,
    model: result.model,
  });
});
