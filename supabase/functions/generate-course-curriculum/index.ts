// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

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

// Deliberately distinct from (and narrower than) the HeyGen functions' WRITER_ROLES
// (["platform_admin", "org_admin", "trainer"]) -- AI curriculum generation is platform_admin-only,
// and this constant must never be widened to match WRITER_ROLES by an accidental future refactor.
const ALLOWED_ROLES = ["platform_admin"];

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Primary model id per the exact model id in use in this environment. If Anthropic rejects this
// literal (e.g. "model not found"), we fall back once to the latest dated Claude Sonnet model id
// known at the time this function was written, and record whichever model actually served the
// request on the course_ai_generations audit row.
const PRIMARY_MODEL = "claude-sonnet-5";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
// A full multi-module course draft (lesson text + video scripts + quiz questions/answers/
// explanations) reliably exceeds 8192 output tokens and was observed truncating mid-generation,
// producing a tool_use block with no usable input. 16000 gives real headroom; the timeout below
// is raised in step to match how long that much generation can take.
const ANTHROPIC_TIMEOUT_MS = 120_000;
const MAX_TOKENS = 16000;

const TOOL_NAME = "emit_course_draft";
const PLAN_TOOL_NAME = "emit_training_plan_draft";

const QUIZ_QUESTION_SCHEMA = {
  type: "object",
  properties: {
    question_text: { type: "string" },
    question_type: { type: "string", enum: ["single_choice", "multiple_choice", "true_false"] },
    points: { type: "integer", minimum: 1 },
    sort_order: { type: "integer", minimum: 1 },
    explanation: { type: "string", description: "Why the correct answer(s) are correct; optional but preferred for a knowledge check." },
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          answer_text: { type: "string" },
          is_correct: { type: "boolean" },
          sort_order: { type: "integer", minimum: 1 },
        },
        required: ["answer_text", "is_correct"],
      },
      minItems: 2,
    },
  },
  required: ["question_text", "question_type", "points", "answers"],
};

const COURSE_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    category: { type: "string" },
    estimated_duration_minutes: { type: "integer", minimum: 1 },
    modules: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          block_type: { type: "string", enum: ["text", "video"] },
          title: { type: "string" },
          content: { type: "string", description: "Full lesson text. Required and only used when block_type is 'text'." },
          script: { type: "string", description: "Natural spoken narration for a HeyGen avatar video. Required and only used when block_type is 'video'. Distinct from, and shorter than, equivalent lesson text -- written to be read aloud." },
          quiz: {
            type: "object",
            description: "Optional knowledge-check quiz attached after this module, where pedagogically appropriate.",
            properties: {
              title: { type: "string" },
              passing_score_percent: { type: "integer", minimum: 1, maximum: 100 },
              questions: { type: "array", items: QUIZ_QUESTION_SCHEMA, minItems: 1 },
            },
            required: ["title", "questions"],
          },
        },
        required: ["block_type", "title"],
      },
    },
  },
  required: ["title", "description", "category", "estimated_duration_minutes", "modules"],
};


const TRAINING_PLAN_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    plan_name: { type: "string" },
    plan_description: { type: "string" },
    courses: { type: "array", minItems: 2, items: COURSE_DRAFT_SCHEMA },
  },
  required: ["plan_name", "plan_description", "courses"],
};

const SYSTEM_PROMPT = `You are an instructional designer drafting a regulated healthcare-staff training course for the emit_course_draft tool.

Hard rules, in priority order:
1. Ground every factual claim strictly in the provided source material when it is supplied. Do not add facts, requirements, or regulatory specifics that are not present in that source material.
2. Never invent specific regulation numbers, statute citations, code sections, or agency rule references that are not explicitly present in the source material. If you are not certain a citation is correct, omit it entirely rather than guessing.
3. When the source material is thin, absent, or ambiguous on a point, say so plainly in the course description (e.g. "based on general best practice; verify against your state's specific regulations") instead of fabricating specifics to sound authoritative.
4. Write instructionally sound content: each module should have a clear learning objective, and most modules should include at least one knowledge-check quiz where pedagogically appropriate (a short definitional or "list all types" module may not need one).
5. Video module scripts (block_type "video") must be natural spoken narration -- shorter, more conversational, and distinct from the fuller lesson text a text module would contain. Never reuse dense written lesson text verbatim as a video script.
6. Every quiz question needs at least 2 answers with exactly the correct ones marked is_correct: true. true_false questions must have exactly 2 answers.
7. Always include a top-level "title" field, even when a working title was already given to you -- restate it (refined if appropriate) rather than omitting it.

Call the emit_course_draft tool exactly once with the complete course draft. Do not include any commentary outside the tool call.`;

const PLAN_SYSTEM_PROMPT = SYSTEM_PROMPT
  .replace("drafting a regulated healthcare-staff training course for the emit_course_draft tool", "drafting a sequenced, multi-course regulated healthcare-staff training plan for the emit_training_plan_draft tool")
  .replace("Call the emit_course_draft tool exactly once with the complete course draft.", "Call the emit_training_plan_draft tool exactly once with the complete training plan draft, including every course in the plan.");

interface CurriculumRequestBody {
  generation_mode?: "course" | "training_plan";
  organization_id?: string;
  plan_name?: string;
  course_count?: number;
  title_hint?: string;
  category?: string;
  training_type_id?: string;
  source_material?: string;
  desired_module_count?: number;
  desired_duration_minutes?: number;
  notes?: string;
}

interface AnthropicCallResult {
  ok: boolean;
  model: string;
  status: number;
  body: Record<string, unknown> | null;
}

async function callAnthropicWithFallback(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  toolName: string,
  inputSchema: Record<string, unknown>,
  signal: AbortSignal,
): Promise<AnthropicCallResult> {
  const candidates = [PRIMARY_MODEL, FALLBACK_MODEL];
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
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: [{ name: toolName, description: "Emit the structured course draft.", input_schema: inputSchema }],
        tool_choice: { type: "tool", name: toolName },
      }),
      signal,
    });
    const bodyJson = await res.json().catch(() => null);
    if (res.ok) return { ok: true, model, status: res.status, body: bodyJson };

    const errorMessage = typeof bodyJson?.error?.message === "string" ? bodyJson.error.message : "";
    const looksLikeModelError = res.status === 404 || (res.status === 400 && /model/i.test(errorMessage));
    last = { ok: false, model, status: res.status, body: bodyJson };
    if (!looksLikeModelError) return last;
    // else: try the next candidate model
  }
  return last!;
}

function extractToolInput(anthropicBody: Record<string, unknown> | null, toolName: string): Record<string, unknown> | null {
  const content = (anthropicBody as { content?: unknown[] } | null)?.content;
  if (!Array.isArray(content)) return null;
  const block = content.find((b) => (b as { type?: string; name?: string })?.type === "tool_use" && (b as { name?: string })?.name === toolName);
  return (block as { input?: Record<string, unknown> } | undefined)?.input ?? null;
}

function isValidPlanDraft(draft: Record<string, unknown> | null): draft is Record<string, unknown> & { courses: Record<string, unknown>[] } {
  if (!draft) return false;
  if (typeof draft.plan_name !== "string" || !draft.plan_name.trim()) return false;
  if (typeof draft.plan_description !== "string" || !draft.plan_description.trim()) return false;
  if (!Array.isArray(draft.courses) || draft.courses.length < 2) return false;
  return draft.courses.every((course) => isValidDraft(course as Record<string, unknown>));
}

function isValidDraft(draft: Record<string, unknown> | null): draft is Record<string, unknown> & { modules: unknown[] } {
  if (!draft) return false;
  if (typeof draft.title !== "string" || !draft.title.trim()) return false;
  if (typeof draft.description !== "string" || !draft.description.trim()) return false;
  if (!Array.isArray(draft.modules) || draft.modules.length === 0) return false;
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

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
    return json({ error: "not authorized to generate AI course curricula" }, 403);
  }

  const { data: aiGenerationSetting } = await callerClient
    .from("platform_settings")
    .select("value")
    .eq("key", "ai_course_generation_enabled")
    .maybeSingle();
  const aiCourseGenerationEnabled = aiGenerationSetting?.value !== false;
  if (!aiCourseGenerationEnabled) {
    return json({ error: "AI course generation is currently disabled by the platform administrator." }, 403);
  }

  // Checked only after auth/role so an unconfigured secret never leaks ahead of a 401/403 to a
  // caller who wasn't going to be allowed to use this endpoint anyway.
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);

  let body: CurriculumRequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { generation_mode, organization_id, plan_name, course_count, title_hint, category, training_type_id, source_material, desired_module_count, desired_duration_minutes, notes } = body;
  const isTrainingPlan = generation_mode === "training_plan";
  if (isTrainingPlan && !organization_id) {
    return json({ error: "organization_id is required when generating a training plan" }, 400);
  }
  if (!title_hint?.trim() && !source_material?.trim() && !notes?.trim() && !plan_name?.trim()) {
    return json({ error: "at least one of plan_name, title_hint, source_material, or notes is required" }, 400);
  }

  // Best-effort: pull the training type's own name/description/citation_note (if any) into the
  // prompt as additional grounding context. Never fails the request -- this is a nice-to-have.
  let trainingTypeContext = "";
  if (training_type_id) {
    const { data: trainingType } = await callerClient
      .from("training_types")
      .select("name, description, citation_note, required_hours")
      .eq("id", training_type_id)
      .maybeSingle();
    if (trainingType) {
      trainingTypeContext = [
        `Training type: ${trainingType.name ?? ""}`,
        trainingType.description ? `Training type description: ${trainingType.description}` : "",
        trainingType.citation_note ? `Known citation note for this training type (only reuse citations that appear here verbatim, never invent additional ones): ${trainingType.citation_note}` : "",
        trainingType.required_hours ? `Required hours: ${trainingType.required_hours}` : "",
      ].filter(Boolean).join("\n");
    }
  }

  const userPromptParts = [
    isTrainingPlan ? "Create a multi-course training plan. Return several complete course drafts that work together as a sequenced curriculum, not one oversized course." : "Create one individual course.",
    plan_name ? `Training plan name: ${plan_name}` : "",
    course_count ? `Desired number of courses in the plan: approximately ${course_count}` : "",
    title_hint ? `Working title / topic: ${title_hint}` : "",
    category ? `Category: ${category}` : "",
    trainingTypeContext,
    desired_module_count ? `Desired module count: approximately ${desired_module_count}` : "",
    desired_duration_minutes ? `Desired total estimated duration: approximately ${desired_duration_minutes} minutes` : "",
    notes ? `Additional notes from the requesting admin: ${notes}` : "",
    source_material?.trim()
      ? `Source material to ground the course in (treat as authoritative; do not contradict or go beyond it for regulatory specifics):\n---\n${source_material}\n---`
      : "No source material was provided. Draft general, instructionally sound training content on this topic, and explicitly flag in the description that regulatory specifics have not been verified against a supplied source and should be reviewed before publishing.",
  ].filter(Boolean).join("\n\n");

  // Audit trail row, inserted before the third-party call so a mid-flight failure (Anthropic
  // error, timeout, RPC failure) still leaves a record with an error_message.
  const { data: generationRow, error: generationInsertError } = await callerClient
    .from("course_ai_generations")
    .insert({
      kind: isTrainingPlan ? "create_training_plan" : "create_course",
      requested_by: callerUser.id,
      model: PRIMARY_MODEL,
      request_params: body,
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
      .from("course_ai_generations")
      .update({ status: "failed", error_message: errorMessage })
      .eq("id", generationId);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  let result: AnthropicCallResult;
  try {
    result = await callAnthropicWithFallback(
      anthropicApiKey,
      isTrainingPlan ? PLAN_SYSTEM_PROMPT : SYSTEM_PROMPT,
      userPromptParts,
      isTrainingPlan ? PLAN_TOOL_NAME : TOOL_NAME,
      isTrainingPlan ? TRAINING_PLAN_DRAFT_SCHEMA : COURSE_DRAFT_SCHEMA,
      controller.signal,
    );
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      await markFailed(`Anthropic API request timed out after ${ANTHROPIC_TIMEOUT_MS / 1000}s`);
      return json({ error: "AI course generation timed out", generation_id: generationId }, 504);
    }
    const message = e instanceof Error ? e.message : String(e);
    await markFailed(message);
    return json({ error: message, generation_id: generationId }, 502);
  }
  clearTimeout(timeoutId);

  if (result.model !== PRIMARY_MODEL) {
    await callerClient.from("course_ai_generations").update({ model: result.model }).eq("id", generationId);
  }

  if (!result.ok) {
    const message = (result.body as { error?: { message?: string } } | null)?.error?.message ?? `Anthropic API returned ${result.status}`;
    await markFailed(message);
    return json({ error: message, generation_id: generationId }, 502);
  }

  if (isTrainingPlan) {
    const planDraft = extractToolInput(result.body, PLAN_TOOL_NAME);
    if (planDraft && (typeof planDraft.plan_name !== "string" || !planDraft.plan_name.trim()) && plan_name?.trim()) {
      planDraft.plan_name = plan_name.trim();
    }
    if (!isValidPlanDraft(planDraft)) {
      await markFailed("AI response did not include a valid multi-course training plan draft");
      return json({ error: "AI response did not include a valid training plan draft", generation_id: generationId }, 502);
    }

    const createdCourses: { course_id: string; course_version_id: string; title: string }[] = [];
    for (let i = 0; i < planDraft.courses.length; i++) {
      const courseDraft = planDraft.courses[i];
      const { data: childGeneration, error: childGenerationError } = await callerClient
        .from("course_ai_generations")
        .insert({ kind: "create_course", requested_by: callerUser.id, model: result.model, request_params: { ...body, plan_generation_id: generationId, course_index: i + 1 }, status: "pending" })
        .select("id")
        .single();
      if (childGenerationError || !childGeneration) {
        await markFailed(childGenerationError?.message ?? "failed to create course audit record for this training plan");
        return json({ error: childGenerationError?.message ?? "failed to create course audit record", generation_id: generationId }, 500);
      }
      const { data: rpcResult, error: rpcError } = await callerClient
        .rpc("create_course_from_ai_draft", { p_draft: courseDraft, p_generation_id: childGeneration.id })
        .single();
      if (rpcError || !rpcResult) {
        await markFailed(rpcError?.message ?? "create_course_from_ai_draft RPC failed");
        return json({ error: rpcError?.message ?? "failed to create a course from the AI training plan", generation_id: generationId }, 500);
      }
      const { course_id, course_version_id } = rpcResult as { course_id: string; course_version_id: string };
      createdCourses.push({ course_id, course_version_id, title: String(courseDraft.title) });
    }

    const { data: plan, error: planError } = await callerClient
      .from("training_plans")
      .insert({ organization_id, name: planDraft.plan_name, description: planDraft.plan_description, created_by: callerUser.id })
      .select("id")
      .single();
    if (planError || !plan) {
      await markFailed(planError?.message ?? "failed to create training plan");
      return json({ error: planError?.message ?? "failed to create training plan", generation_id: generationId }, 500);
    }
    const { error: itemsError } = await callerClient.from("training_plan_items").insert(
      createdCourses.map((course, index) => ({ training_plan_id: plan.id, course_id: course.course_id, sort_order: index + 1, is_required: true })),
    );
    if (itemsError) {
      await markFailed(itemsError.message);
      return json({ error: itemsError.message, generation_id: generationId }, 500);
    }
    await callerClient.from("course_ai_generations").update({ status: "completed", response_summary: { plan_name: planDraft.plan_name, course_count: createdCourses.length } }).eq("id", generationId);
    return json({ success: true, training_plan_id: plan.id, courses: createdCourses, generation_id: generationId });
  }

  const draft = extractToolInput(result.body, TOOL_NAME);
  if (draft && (typeof draft.title !== "string" || !draft.title.trim()) && title_hint?.trim()) {
    draft.title = title_hint.trim();
  }
  if (!isValidDraft(draft)) {
    await markFailed("AI response did not include a valid course draft (missing title/description/modules)");
    return json({ error: "AI response did not include a valid course draft", generation_id: generationId }, 502);
  }

  const { data: rpcResult, error: rpcError } = await callerClient
    .rpc("create_course_from_ai_draft", { p_draft: draft, p_generation_id: generationId })
    .single();
  if (rpcError || !rpcResult) {
    await markFailed(rpcError?.message ?? "create_course_from_ai_draft RPC failed");
    return json({ error: rpcError?.message ?? "failed to create course from AI draft", generation_id: generationId }, 500);
  }

  const { course_id: courseId, course_version_id: courseVersionId } = rpcResult as { course_id: string; course_version_id: string };
  if (training_type_id) {
    await callerClient.from("courses").update({ training_type_id }).eq("id", courseId);
  }
  await callerClient
    .from("course_ai_generations")
    .update({ response_summary: { title: draft.title, module_count: (draft.modules as unknown[]).length } })
    .eq("id", generationId);

  return json({ success: true, course_id: courseId, course_version_id: courseVersionId, generation_id: generationId });
});
